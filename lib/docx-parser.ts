import JSZip from "jszip"

export interface DocxChange {
  id: string
  type: "insertion" | "deletion"
  author: string
  date: string | null
  text: string
  sectionId?: string // New field to group changes by section
  paragraphId?: string // More granular grouping
}

export interface DocxComment {
  id: string
  author: string
  date: string | null
  text: string
  initials?: string
  parentCommentId?: string // For threaded comments
  sectionId?: string
  paragraphId?: string
}

// Helper to recursively get all text from a w:r (run) or similar node
const getTextFromNode = (node: Element): string => {
  let text = ""
  
  // Look for w:t elements (text nodes) - these can be direct children or nested in w:r elements
  const textNodes = node.getElementsByTagName("w:t")
  for (let i = 0; i < textNodes.length; i++) {
    const textContent = textNodes[i].textContent || ""
    // The `xml:space="preserve"` attribute is important for preserving whitespace
    if (textNodes[i].getAttribute("xml:space") === "preserve") {
      text += textContent
    } else {
      text += textContent.trim()
    }
  }
  
  // If no w:t elements found, check for w:r (run) elements that might contain text
  if (!text) {
    const runNodes = node.getElementsByTagName("w:r")
    for (let i = 0; i < runNodes.length; i++) {
      const runTextNodes = runNodes[i].getElementsByTagName("w:t")
      for (let j = 0; j < runTextNodes.length; j++) {
        const textContent = runTextNodes[j].textContent || ""
        if (runTextNodes[j].getAttribute("xml:space") === "preserve") {
          text += textContent
        } else {
          text += textContent.trim()
        }
      }
    }
  }
  
  // Only log when we actually have text content
  if (text) {
    //console.log("Extracted text from node:", text)
  }
  
  return text
}

// Helper to find the parent paragraph or section for a change node
const findSectionInfo = (node: Element): { sectionId: string; paragraphId: string } => {
  let current = node.parentElement
  let paragraphElement: Element | null = null
  let sectionElement: Element | null = null
  
  // Walk up the DOM tree to find paragraph and section information
  while (current) {
    // Look for paragraph element (w:p)
    if (current.tagName === "w:p" && !paragraphElement) {
      paragraphElement = current
    }
    
    // Look for section break or heading elements
    if (current.tagName === "w:sectPr" || current.tagName === "w:body") {
      sectionElement = current
      break
    }
    
    // Check for heading styles using getElementsByTagName (more reliable for XML)
    const pStyleElements = current.getElementsByTagName("w:pStyle")
    for (let i = 0; i < pStyleElements.length; i++) {
      const styleVal = pStyleElements[i].getAttribute("w:val")
      if (styleVal && styleVal.includes("Heading")) {
        sectionElement = current
        break
      }
    }
    
    if (sectionElement) break
    
    current = current.parentElement
  }
  
  // Generate IDs based on position in document
  const paragraphId = paragraphElement 
    ? `para-${Array.from(paragraphElement.parentElement?.children || []).indexOf(paragraphElement)}`
    : `para-unknown-${Math.random().toString(36).substr(2, 9)}`
    
  const sectionId = sectionElement
    ? `section-${Array.from(sectionElement.parentElement?.children || []).indexOf(sectionElement)}`
    : paragraphId.split('-')[0] + '-section' // Group by paragraph if no clear section
    
  return { sectionId, paragraphId }
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
    console.log("Parsed XML document:", xmlDoc)
    const changes: DocxChange[] = []

    // Process insertions
    const insertions = xmlDoc.getElementsByTagName("w:ins")
    for (let i = 0; i < insertions.length; i++) {
      const node = insertions[i]
      const text = getTextFromNode(node)
      if (text) {
        const { sectionId, paragraphId } = findSectionInfo(node)
        changes.push({
          id: node.getAttribute("w:id") || `ins-${i}`,
          type: "insertion",
          author: node.getAttribute("w:author") || "Unknown",
          date: node.getAttribute("w:date"),
          text: text,
          sectionId,
          paragraphId,
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
        const { sectionId, paragraphId } = findSectionInfo(node)
        changes.push({
          id: node.getAttribute("w:id") || `del-${i}`,
          type: "deletion",
          author: node.getAttribute("w:author") || "Unknown",
          date: node.getAttribute("w:date"),
          text: text,
          sectionId,
          paragraphId,
        })
      }
    }
    //console.log("Extracted changes:", changes)
    return changes
  } catch (error) {
    console.error("Error parsing DOCX file:", error)
    return []
  }
}

export async function extractComments(file: File): Promise<DocxComment[]> {
  try {
    const zip = await JSZip.loadAsync(file)
    const commentsXmlFile = zip.file("word/comments.xml")

    if (!commentsXmlFile) {
      // No comments file means no comments in the document
      return []
    }

    const xmlString = await commentsXmlFile.async("string")
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, "application/xml")
    console.log("Parsed comments XML document:", xmlDoc)
    
    const comments: DocxComment[] = []
    const commentElements = xmlDoc.getElementsByTagName("w:comment")
    
    for (let i = 0; i < commentElements.length; i++) {
      const commentElement = commentElements[i]
      const commentText = getTextFromNode(commentElement)
      
      if (commentText) {
        comments.push({
          id: commentElement.getAttribute("w:id") || `comment-${i}`,
          author: commentElement.getAttribute("w:author") || "Unknown",
          date: commentElement.getAttribute("w:date"),
          text: commentText,
          initials: commentElement.getAttribute("w:initials") || undefined,
          parentCommentId: commentElement.getAttribute("w:parentId") || undefined,
          // Note: sectionId and paragraphId would need to be determined from document.xml
          // by finding the commentReference elements
        })
      }
    }
    
    //console.log("Extracted comments:", comments)
    return comments
  } catch (error) {
    console.error("Error parsing comments from DOCX file:", error)
    return []
  }
}
