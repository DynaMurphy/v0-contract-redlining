import { type NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { DOMParser, XMLSerializer } from "xmldom"

// Helper to replace the content of a node with new text
function replaceNodeContentWithText(xmlDoc: Document, node: Element, text: string) {
  // Clear existing content
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }

  // Create new run and text elements, which is the standard structure
  const newRun = xmlDoc.createElement("w:r")
  const newText = xmlDoc.createElement("w:t")

  // Preserve whitespace in the new text
  newText.setAttribute("xml:space", "preserve")
  newText.appendChild(xmlDoc.createTextNode(text))

  newRun.appendChild(newText)
  node.appendChild(newRun)
}

// Helper to create a new w:ins node for proposals
function createInsertionNode(xmlDoc: Document, text: string, author: string, newId: number): Element {
  const insNode = xmlDoc.createElement("w:ins")
  insNode.setAttribute("w:id", String(newId))
  insNode.setAttribute("w:author", author)
  insNode.setAttribute("w:date", new Date().toISOString())

  const runNode = xmlDoc.createElement("w:r")
  const textNode = xmlDoc.createElement("w:t")
  textNode.setAttribute("xml:space", "preserve")
  textNode.appendChild(xmlDoc.createTextNode(text))

  runNode.appendChild(textNode)
  insNode.appendChild(runNode)

  return insNode
}

async function handleAcceptInsertion(xmlDoc: Document, changeId: string) {
  const insertions = xmlDoc.getElementsByTagName("w:ins")
  for (let i = 0; i < insertions.length; i++) {
    const node = insertions[i]
    if (node.getAttribute("w:id") === changeId) {
      const parent = node.parentNode
      if (!parent) continue

      // Move all children of the <w:ins> tag to be direct children of the parent
      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node)
      }
      parent.removeChild(node)
      return
    }
  }
  throw new Error(`Insertion with ID ${changeId} not found.`)
}

async function handleRejectInsertion(xmlDoc: Document, changeId: string) {
  const insertions = xmlDoc.getElementsByTagName("w:ins")
  for (let i = 0; i < insertions.length; i++) {
    const node = insertions[i]
    if (node.getAttribute("w:id") === changeId) {
      node.parentNode?.removeChild(node)
      return
    }
  }
  throw new Error(`Insertion with ID ${changeId} not found.`)
}

async function handleAcceptDeletion(xmlDoc: Document, changeId: string) {
  const deletions = xmlDoc.getElementsByTagName("w:del")
  for (let i = 0; i < deletions.length; i++) {
    const node = deletions[i]
    if (node.getAttribute("w:id") === changeId) {
      // To accept a deletion, we simply remove the <w:del> node
      node.parentNode?.removeChild(node)
      return
    }
  }
  throw new Error(`Deletion with ID ${changeId} not found.`)
}

async function handleRejectDeletion(xmlDoc: Document, changeId: string) {
  const deletions = xmlDoc.getElementsByTagName("w:del")
  for (let i = 0; i < deletions.length; i++) {
    const node = deletions[i]
    if (node.getAttribute("w:id") === changeId) {
      const parent = node.parentNode
      if (parent) {
        // Unwrap the content of the <w:del> tag, effectively restoring it
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node)
        }
        parent.removeChild(node)
      }
      return
    }
  }
  throw new Error(`Deletion with ID ${changeId} not found.`)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const changeId = formData.get("changeId") as string
    const changeType = formData.get("changeType") as "insertion" | "deletion"
    const action = formData.get("action") as "accept" | "reject"
    const proposedText = formData.get("proposedText") as string | null
    const reviewerName = formData.get("reviewerName") as string | null

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

    // Special handling for "accept with proposal" to create a new tracked change
    if (action === "accept" && proposedText && proposedText.trim() !== "") {
      const allChangeNodes = [
        ...Array.from(xmlDoc.getElementsByTagName("w:ins")),
        ...Array.from(xmlDoc.getElementsByTagName("w:del")),
      ]
      let maxId = 0
      allChangeNodes.forEach((node) => {
        const element = node as Element
        const id = Number.parseInt(element.getAttribute("w:id") || "0", 10)
        if (id > maxId) {
          maxId = id
        }
      })
      const newChangeId = maxId + 1

      let targetNode: Element | null = null
      const nodes = xmlDoc.getElementsByTagName(changeType === "insertion" ? "w:ins" : "w:del")
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute("w:id") === changeId) {
          targetNode = nodes[i]
          break
        }
      }

      if (targetNode && targetNode.parentNode) {
        const authorName = reviewerName?.trim() || "Anonymous Reviewer"
        const newInsertion = createInsertionNode(xmlDoc, proposedText, authorName, newChangeId)
        targetNode.parentNode.insertBefore(newInsertion, targetNode)
        targetNode.parentNode.removeChild(targetNode)
      } else {
        throw new Error(`Node with ID ${changeId} not found or has no parent.`)
      }
    } else {
      // Apply the simple change
      if (action === "accept") {
        if (changeType === "insertion") await handleAcceptInsertion(xmlDoc, changeId)
        if (changeType === "deletion") await handleAcceptDeletion(xmlDoc, changeId)
      } else {
        // reject
        if (changeType === "insertion") await handleRejectInsertion(xmlDoc, changeId)
        if (changeType === "deletion") await handleRejectDeletion(xmlDoc, changeId)
      }
    }

    const serializer = new XMLSerializer()
    const newXmlString = serializer.serializeToString(xmlDoc)
    zip.file("word/document.xml", newXmlString)

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
