import { type NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"

interface ContractSection {
  level: number
  number: string
  title: string
  id: string
}

// Helper to pull out level-1 and level-2 headings from HTML
function parseHeadingsFromHtml(html: string): ContractSection[] {
  const headers: ContractSection[] = []
  
  console.log('HTML sample:', html.substring(0, 1000))
  
  // First, find document title
  const titleMatch = html.match(/<p><strong>(COOPERATIVE\s+ALLIANCE\s+AGREEMENT|.*?AGREEMENT|.*?CONTRACT)[^<]*<\/strong><\/p>/i)
  if (titleMatch) {
    const title = titleMatch[1].replace(/<[^>]*>/g, '').trim()
    headers.push({
      level: 0,
      number: "",
      title: title,
      id: "document-title"
    })
    console.log('Found title:', title)
  }
  
  // Find all list items with strong tags - this is where the sections are
  const listItemRegex = /<li[^>]*><strong>([^<]+)<\/strong>[^<]*(?:\.|<)/gi
  let match
  let sectionCounter = 1
  
  while ((match = listItemRegex.exec(html)) !== null) {
    const sectionTitle = match[1].trim()
    console.log('Found list item with strong:', sectionTitle)
    
    // Skip if it's obviously not a section title
    if (sectionTitle.length < 3 || sectionTitle.length > 100) continue
    if (sectionTitle.match(/Philips CAA Number|LSP\d+/i)) continue
    
    // Check if this looks like a subsection (nested in another list)
    const beforeMatch = html.substring(0, match.index)
    const nestedLevel = (beforeMatch.match(/<ol[^>]*>/g) || []).length - (beforeMatch.match(/<\/ol>/g) || []).length
    
    headers.push({
      level: nestedLevel > 1 ? 2 : 1,
      number: nestedLevel > 1 ? "" : sectionCounter.toString(),
      title: sectionTitle,
      id: `section-${sectionTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    })
    
    if (nestedLevel <= 1) sectionCounter++
    console.log('Added section:', sectionTitle, 'Level:', nestedLevel > 1 ? 2 : 1)
  }
  
  // Also look for numbered paragraphs like "2.1.1 Customer represents..."
  const numberedParaRegex = /<p[^>]*>(\d+\.\d+\.\d+)\s+([^<]{10,100})/gi
  while ((match = numberedParaRegex.exec(html)) !== null) {
    const number = match[1]
    const title = match[2].trim()
    
    if (title.length > 10 && title.length < 100) {
      headers.push({
        level: 3,
        number: number,
        title: title,
        id: `section-${number.replace(/\./g, '-')}`
      })
      console.log('Added numbered paragraph:', number, title.substring(0, 50))
    }
  }
  
  console.log(`Total sections found: ${headers.length}`)
  return headers
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    
    if (!file.name.toLowerCase().endsWith('.docx')) {
      return NextResponse.json({ error: "File must be a .docx document" }, { status: 400 })
    }
    
    // Convert file to buffer
    const buffer = await file.arrayBuffer()
    
    // Convert DOCX to HTML using mammoth with better style mapping
    const result = await mammoth.convertToHtml({ 
      buffer: Buffer.from(buffer)
    }, {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='heading 1'] => h1:fresh",
        "p[style-name='heading 2'] => h2:fresh",
        "p[style-name='heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh"
      ]
    })
    const html = result.value
    
    // Extract headings from HTML
    const sections = parseHeadingsFromHtml(html)
    
    // Log any conversion messages for debugging
    if (result.messages.length > 0) {
      console.log('Mammoth conversion messages:', result.messages)
    }
    
    // Debug logging to see what sections were found
    console.log(`Found ${sections.length} sections:`)
    sections.forEach(section => {
      console.log(`  Level ${section.level}: ${section.number} - ${section.title}`)
    })
    
    // Also log a sample of the HTML for debugging if no sections found
    if (sections.length === 0) {
      console.log('No sections found. Sample HTML content:')
      console.log(html.substring(0, 1000) + '...')
    }
    
    return NextResponse.json({ 
      sections,
      totalSections: sections.length,
      success: true,
      debug: {
        htmlLength: html.length,
        sampleHtml: sections.length === 0 ? html.substring(0, 500) : undefined
      }
    })
    
  } catch (error) {
    console.error("Error parsing contract:", error)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
    return NextResponse.json({ 
      error: "Failed to parse contract", 
      details: errorMessage 
    }, { status: 500 })
  }
}
