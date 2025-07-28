import JSZip from "jszip"

export interface DocxChange {
  id: string
  type: "insertion" | "deletion"
  author: string
  date: string | null
  text: string
}

// Helper to recursively get all text from a w:r (run) or similar node
const getTextFromNode = (node: Element): string => {
  let text = ""
  const textNodes = node.getElementsByTagName("w:t")
  for (let i = 0; i < textNodes.length; i++) {
    // The `xml:space="preserve"` attribute is important for preserving whitespace
    if (textNodes[i].getAttribute("xml:space") === "preserve") {
      text += textNodes[i].textContent
    } else {
      text += textNodes[i].textContent?.trim()
    }
  }
  return text
}

export async function extractChanges(file: File): Promise<DocxChange[]> {
  try {
    const zip = await JSZip.loadAsync(file)
    const docXmlFile = zip.file("word/document.xml")

    if (!docXmlFile) {
      throw new Error("document.xml not found in the docx file.")
    }

    const xmlString = await docXmlFile.async("string")
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, "application/xml")

    const changes: DocxChange[] = []

    // Process insertions
    const insertions = xmlDoc.getElementsByTagName("w:ins")
    for (let i = 0; i < insertions.length; i++) {
      const node = insertions[i]
      const text = getTextFromNode(node)
      if (text) {
        changes.push({
          id: node.getAttribute("w:id") || `ins-${i}`,
          type: "insertion",
          author: node.getAttribute("w:author") || "Unknown",
          date: node.getAttribute("w:date"),
          text: text,
        })
      }
    }

    // Process deletions
    const deletions = xmlDoc.getElementsByTagName("w:del")
    for (let i = 0; i < deletions.length; i++) {
      const node = deletions[i]
      // Deletion nodes contain w:delText for the text
      const delTextNodes = node.getElementsByTagName("w:delText")
      let text = ""
      for (let j = 0; j < delTextNodes.length; j++) {
        if (delTextNodes[j].getAttribute("xml:space") === "preserve") {
          text += delTextNodes[j].textContent
        } else {
          text += delTextNodes[j].textContent?.trim()
        }
      }

      if (text) {
        changes.push({
          id: node.getAttribute("w:id") || `del-${i}`,
          type: "deletion",
          author: node.getAttribute("w:author") || "Unknown",
          date: node.getAttribute("w:date"),
          text: text,
        })
      }
    }

    return changes
  } catch (error) {
    console.error("Error parsing DOCX file:", error)
    return []
  }
}
