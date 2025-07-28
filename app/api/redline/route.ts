import { type NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { DOMParser, XMLSerializer } from "xmldom"

// This is a simplified handler. A real-world app would need more robust error handling
// and support for different change types (deletions, format changes, etc.).
async function handleAcceptInsertion(xmlDoc: Document, changeId: string) {
  const insertions = xmlDoc.getElementsByTagName("w:ins")
  let found = false

  for (let i = 0; i < insertions.length; i++) {
    const node = insertions[i]
    if (node.getAttribute("w:id") === changeId) {
      found = true
      const parent = node.parentNode
      if (parent) {
        // Move all children of the <w:ins> tag to be direct children of the parent
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node)
        }
        // Remove the now-empty <w:ins> tag
        parent.removeChild(node)
      }
      break
    }
  }

  if (!found) {
    throw new Error(`Change with ID ${changeId} not found.`)
  }
}

async function handleRejectInsertion(xmlDoc: Document, changeId: string) {
  const insertions = xmlDoc.getElementsByTagName("w:ins")
  let found = false
  for (let i = 0; i < insertions.length; i++) {
    const node = insertions[i]
    if (node.getAttribute("w:id") === changeId) {
      found = true
      node.parentNode?.removeChild(node)
      break
    }
  }
  if (!found) throw new Error(`Change with ID ${changeId} not found.`)
}

async function handleAcceptDeletion(xmlDoc: Document, changeId: string) {
  const deletions = xmlDoc.getElementsByTagName("w:del")
  let found = false
  for (let i = 0; i < deletions.length; i++) {
    const node = deletions[i]
    if (node.getAttribute("w:id") === changeId) {
      found = true
      node.parentNode?.removeChild(node)
      break
    }
  }
  if (!found) throw new Error(`Change with ID ${changeId} not found.`)
}

async function handleRejectDeletion(xmlDoc: Document, changeId: string) {
  const deletions = xmlDoc.getElementsByTagName("w:del")
  let found = false
  for (let i = 0; i < deletions.length; i++) {
    const node = deletions[i]
    if (node.getAttribute("w:id") === changeId) {
      found = true
      const parent = node.parentNode
      if (parent) {
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node)
        }
        parent.removeChild(node)
      }
      break
    }
  }
  if (!found) throw new Error(`Change with ID ${changeId} not found.`)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const changeId = formData.get("changeId") as string
    const changeType = formData.get("changeType") as "insertion" | "deletion"
    const action = formData.get("action") as "accept" | "reject"

    if (!file || !changeId || !action || !changeType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const fileBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(fileBuffer)
    const docXmlFile = zip.file("word/document.xml")

    if (!docXmlFile) {
      return NextResponse.json({ error: "Invalid DOCX file" }, { status: 400 })
    }

    const xmlString = await docXmlFile.async("string")
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, "application/xml")

    // Apply the change
    if (action === "accept") {
      if (changeType === "insertion") await handleAcceptInsertion(xmlDoc, changeId)
      if (changeType === "deletion") await handleAcceptDeletion(xmlDoc, changeId)
    } else {
      // reject
      if (changeType === "insertion") await handleRejectInsertion(xmlDoc, changeId)
      if (changeType === "deletion") await handleRejectDeletion(xmlDoc, changeId)
    }

    const serializer = new XMLSerializer()
    const newXmlString = serializer.serializeToString(xmlDoc)

    // Update the zip with the modified XML
    zip.file("word/document.xml", newXmlString)

    // Generate the new docx file
    const newDocxBuffer = await zip.generateAsync({
      type: "nodebuffer",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })

    return new NextResponse(newDocxBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="modified_${file.name}"`,
      },
    })
  } catch (error) {
    console.error("Error processing redline action:", error)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
    return NextResponse.json({ error: "Failed to process document", details: errorMessage }, { status: 500 })
  }
}
