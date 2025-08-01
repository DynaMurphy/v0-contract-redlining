"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { type DocxChange, type DocxComment, extractChanges, extractComments } from "@/lib/docx-parser"
import { renderAsync } from "docx-preview"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { UploadCloud, FileText, MessageSquare, Check, X, User, Calendar, History, ChevronDown, ChevronUp, Download, RefreshCw, MoreVertical, ZoomIn, ZoomOut, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface ProcessedChange {
  id: string
  originalChange: DocxChange
  action: "accepted" | "rejected"
  proposedText?: string
  processedAt: Date
  reviewerName: string
}

interface ContractSection {
  level: number
  number: string
  title: string
  id: string
}

interface GroupedChanges {
  [sectionId: string]: {
    changes: DocxChange[]
    sectionName: string
    latestDate: Date | null
  }
}

// Helper function to group changes by section and sort by date
const groupChangesBySection = (changes: DocxChange[], contractSections: ContractSection[]): GroupedChanges => {
  const grouped: GroupedChanges = {}
  
  // Create a better matching system for changes to contract sections
  const findBestMatchingSection = (change: DocxChange): ContractSection | null => {
    if (!contractSections.length) return null
    
    // First, try to match based on text content similarity
    if (change.text && change.text.length > 10) {
      for (const section of contractSections) {
        // Check if the change text contains keywords from the section title
        const sectionWords = section.title.toLowerCase().split(/\s+/).filter(word => word.length > 3)
        const changeText = change.text.toLowerCase()
        
        const matchCount = sectionWords.filter(word => changeText.includes(word)).length
        if (matchCount > 0 && matchCount / sectionWords.length > 0.3) {
          return section
        }
      }
    }
    
    // Fallback: use document order as a rough approximation
    // Extract numeric part from section/paragraph IDs to estimate position
    const extractPosition = (id: string): number => {
      const match = id.match(/(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    }
    
    const changePosition = extractPosition(change.sectionId || change.paragraphId || '0')
    
    // Find the section that would be at approximately this position in the document
    if (contractSections.length > 0) {
      const sectionIndex = Math.min(
        Math.floor((changePosition / 100) * contractSections.length),
        contractSections.length - 1
      )
      return contractSections[sectionIndex]
    }
    
    return null
  }
  
  changes.forEach(change => {
    // Try to find the best matching contract section
    const matchingSection = findBestMatchingSection(change)
    
    let sectionId: string
    let sectionName: string
    
    if (matchingSection) {
      sectionId = matchingSection.id
      sectionName = matchingSection.title
    } else {
      // Fallback to original behavior but with cleaner naming
      sectionId = change.sectionId || change.paragraphId || 'unknown'
      sectionName = 'Document Section'
    }
    
    if (!grouped[sectionId]) {
      grouped[sectionId] = {
        changes: [],
        sectionName,
        latestDate: null
      }
    }
    
    grouped[sectionId].changes.push(change)
    
    // Update latest date for sorting sections
    const changeDate = change.date ? new Date(change.date) : null
    if (changeDate && (!grouped[sectionId].latestDate || changeDate > grouped[sectionId].latestDate!)) {
      grouped[sectionId].latestDate = changeDate
    }
  })
  
  // Sort changes within each section by date (newest first)
  Object.values(grouped).forEach(section => {
    section.changes.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0
      const dateB = b.date ? new Date(b.date).getTime() : 0
      return dateB - dateA // Newest first
    })
  })
  
  return grouped
}

// Component for rendering individual change
const ChangeCard = ({ 
  change, 
  selectedChangeId, 
  proposedTexts, 
  isProcessing, 
  onSelectChange, 
  onProposalChange, 
  onRedlineAction 
}: { 
  change: DocxChange
  selectedChangeId: string | null
  proposedTexts: Record<string, string>
  isProcessing: boolean
  onSelectChange: (change: DocxChange) => void
  onProposalChange: (changeId: string, text: string) => void
  onRedlineAction: (change: DocxChange, action: "accept" | "reject", useOriginal?: boolean) => void
}) => (
  <Card
    onClick={() => onSelectChange(change)}
    className={cn(
      "cursor-pointer transition-all hover:shadow-md mb-2",
      selectedChangeId === change.id
        ? "border-primary ring-2 ring-primary"
        : "border-gray-200 dark:border-gray-700",
    )}
  >
    <CardHeader className="p-3">
      <div className="flex justify-between items-start">
        <div>
          <Badge variant={change.type === "insertion" ? "default" : "destructive"}>
            {change.type === "insertion" ? "Insertion" : "Deletion"}
          </Badge>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <User size={12} /> {change.author}
            </div>
            {change.date && (
              <div className="flex items-center gap-1">
                <Calendar size={12} /> {new Date(change.date).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </CardHeader>
    <CardContent className="p-3 pt-0">
      <p
        className={cn(
          "text-sm p-2 rounded-md",
          change.type === "insertion"
            ? "bg-green-50 dark:bg-green-900/50 text-green-800 dark:text-green-200"
            : "bg-red-50 dark:bg-red-900/50 text-red-800 dark:text-red-200 line-through",
        )}
      >
        {change.text}
      </p>
      {selectedChangeId === change.id && (
        <div className="mt-3 space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare size={16} /> Actions
          </h4>
          <Textarea
            placeholder="Propose alternative text..."
            className="text-sm"
            value={proposedTexts[change.id] || ""}
            onChange={(e) => onProposalChange(change.id, e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => onRedlineAction(change, "accept", true)}
              disabled={isProcessing}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="w-4 h-4 mr-1" /> Accept Original
            </Button>
            {proposedTexts[change.id]?.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRedlineAction(change, "accept", false)}
                disabled={isProcessing}
                className="border-blue-500 text-blue-600 hover:bg-blue-50"
              >
                <Check className="w-4 h-4 mr-1" /> Accept Proposal
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRedlineAction(change, "reject")}
              disabled={isProcessing}
              className="border-red-500 text-red-600 hover:bg-red-50"
            >
              <X className="w-4 h-4 mr-1" /> Reject
            </Button>
          </div>
        </div>
      )}
    </CardContent>
  </Card>
)

export default function ContractRedlinePage() {
  const [file, setFile] = useState<File | null>(null)
  const [changes, setChanges] = useState<DocxChange[]>([])
  const [comments, setComments] = useState<DocxComment[]>([])
  const [processedChanges, setProcessedChanges] = useState<ProcessedChange[]>([])
  const [contractSections, setContractSections] = useState<ContractSection[]>([])
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [proposedTexts, setProposedTexts] = useState<Record<string, string>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [activeTab, setActiveTab] = useState<"changes" | "comments">("changes")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [reviewerName, setReviewerName] = useState<string>("Murphy van Oijen")
  const [zoomLevel, setZoomLevel] = useState<number>(100)

  const documentViewerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const originalTextRef = useRef<string | null>(null)

  // Group changes by section for better organization
  const groupedChanges = useMemo(() => {
    const grouped = groupChangesBySection(changes, contractSections)
    //console.log("Grouped changes:", grouped)
    return grouped
  }, [changes, contractSections])
  
  // Sort sections by latest change date
  const sortedSections = useMemo(() => {
    const sorted = Object.entries(groupedChanges).sort(([, a], [, b]) => {
      const dateA = a.latestDate?.getTime() || 0
      const dateB = b.latestDate?.getTime() || 0
      return dateB - dateA // Newest sections first
    })
    //console.log("Sorted sections:", sorted)
    return sorted
  }, [groupedChanges])

  const clearHighlights = useCallback(() => {
    const viewer = documentViewerRef.current
    if (!viewer) return

    if (originalTextRef.current) {
      const currentMark = viewer.querySelector("mark.live-edit")
      if (currentMark) {
        currentMark.textContent = originalTextRef.current
        currentMark.classList.remove("live-edit")
      }
      originalTextRef.current = null
    }

    const existingHighlights = viewer.querySelectorAll("mark")
    existingHighlights.forEach((mark) => {
      const parent = mark.parentNode
      if (parent && mark.textContent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark)
        parent.normalize()
      }
    })
  }, [])

  const highlightTextInViewer = useCallback(
    (text: string) => {
      const viewer = documentViewerRef.current
      if (!viewer || !text) return

      clearHighlights()

      const treeWalker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null)
      let currentNode
      while ((currentNode = treeWalker.nextNode())) {
        if (currentNode instanceof Text) {
          const index = currentNode.nodeValue?.indexOf(text)
          if (index !== -1 && typeof index === "number") {
            const range = document.createRange()
            range.setStart(currentNode, index)
            range.setEnd(currentNode, index + text.length)
            const mark = document.createElement("mark")
            mark.className = "bg-yellow-200 dark:bg-yellow-700 rounded px-1"
            range.surroundContents(mark)
            mark.scrollIntoView({ behavior: "smooth", block: "center" })
            originalTextRef.current = text
            return
          }
        }
      }
    },
    [clearHighlights],
  )

  useEffect(() => {
    const viewer = documentViewerRef.current
    if (!viewer || !selectedChangeId) return

    const mark = viewer.querySelector("mark")
    if (!mark) return

    const proposedText = proposedTexts[selectedChangeId]

    if (typeof proposedText === "string") {
      mark.textContent = proposedText
      mark.classList.add("live-edit", "bg-blue-200", "dark:bg-blue-700")
    } else if (originalTextRef.current) {
      mark.textContent = originalTextRef.current
      mark.classList.remove("live-edit", "bg-blue-200", "dark:bg-blue-700")
    }
  }, [proposedTexts, selectedChangeId])

  const parseContractSections = async (file: File): Promise<ContractSection[]> => {
    try {
      const formData = new FormData()
      formData.append("file", file)
      
      const response = await fetch("/api/parse-contract", {
        method: "POST",
        body: formData,
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details || "Failed to parse contract sections")
      }
      
      const data = await response.json()
      return data.sections || []
    } catch (error) {
      console.error("Error parsing contract sections:", error)
      return []
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return
    if (!uploadedFile.name.endsWith(".docx")) {
      setError("Please upload a valid .docx file.")
      return
    }
    setIsLoading(true)
    setError(null)
    setFile(uploadedFile)
    setChanges([])
    setComments([])
    setProcessedChanges([])
    setContractSections([])
    setSelectedChangeId(null)
    setSelectedCommentId(null)
    setProposedTexts({})
    setExpandedSections(new Set())
    setZoomLevel(100)
    
    try {
      // Extract changes, comments, and contract sections in parallel
      const [extractedChanges, extractedComments, parsedSections] = await Promise.all([
        extractChanges(uploadedFile),
        extractComments(uploadedFile),
        parseContractSections(uploadedFile)
      ])
      
      //console.log("Extracted changes count:", extractedChanges.length)
      //console.log("Extracted comments count:", extractedComments.length)
      //console.log("Parsed sections count:", parsedSections.length)
      //console.log("Changes data:", extractedChanges)
      
      setChanges(extractedChanges)
      setComments(extractedComments)
      setContractSections(parsedSections)
      
      if (documentViewerRef.current) {
        documentViewerRef.current.innerHTML = ""
        await renderAsync(uploadedFile, documentViewerRef.current)
      }
    } catch (e) {
      console.error(e)
      setError("Failed to process the document.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectChange = (change: DocxChange) => {
    setSelectedChangeId(change.id)
    setSelectedCommentId(null) // Clear comment selection
    highlightTextInViewer(change.text)
  }

  const handleSelectComment = (comment: DocxComment) => {
    setSelectedCommentId(comment.id)
    setSelectedChangeId(null) // Clear change selection
    // Comments don't have specific text to highlight in the same way
    // but we could implement comment highlighting differently
  }

  const toggleSectionExpansion = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  const handleProposalChange = (changeId: string, text: string) => {
    setProposedTexts((prev) => ({ ...prev, [changeId]: text }))
  }

  const triggerFileUpload = () => {
    fileInputRef.current?.click()
  }

  const handleReload = async () => {
    if (!file) return
    
    setIsLoading(true)
    setError(null)
    setChanges([])
    setComments([])
    setProcessedChanges([])
    setContractSections([])
    setSelectedChangeId(null)
    setSelectedCommentId(null)
    setProposedTexts({})
    setExpandedSections(new Set())
    setZoomLevel(100)
    
    try {
      // Extract changes, comments, and contract sections in parallel
      const [extractedChanges, extractedComments, parsedSections] = await Promise.all([
        extractChanges(file),
        extractComments(file),
        parseContractSections(file)
      ])
      
      setChanges(extractedChanges)
      setComments(extractedComments)
      setContractSections(parsedSections)
      
      if (documentViewerRef.current) {
        documentViewerRef.current.innerHTML = ""
        await renderAsync(file, documentViewerRef.current)
      }
    } catch (e) {
      console.error(e)
      setError("Failed to reload the document.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!file) return
    
    try {
      // Create a copy of the original file for download
      // In a real application, you would apply the processed changes here
      const blob = new Blob([file], { type: file.type })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name.replace('.docx', '_reviewed.docx')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Error downloading file:', e)
      setError("Failed to download the document.")
    }
  }

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 25, 200)) // Max zoom 200%
  }

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 25, 50)) // Min zoom 50%
  }

  const handleZoomReset = () => {
    setZoomLevel(100) // Reset to 100%
  }

  const handleRedlineAction = async (change: DocxChange, action: "accept" | "reject", useOriginal: boolean = false) => {
    if (!file) return
    setIsProcessing(true)
    setError(null)

    const proposedText = proposedTexts[change.id]
    const isProposal = action === "accept" && !useOriginal && typeof proposedText === "string" && proposedText.trim() !== ""

    const formData = new FormData()
    formData.append("file", file)
    formData.append("changeId", change.id)
    formData.append("changeType", change.type)
    formData.append("action", action)
    formData.append("reviewerName", reviewerName.trim() || "Anonymous")
    if (isProposal) {
      formData.append("proposedText", proposedText)
    }

    try {
      const response = await fetch("/api/redline", { method: "POST", body: formData })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details || "Failed to update document.")
      }
      const newFileBlob = await response.blob()
      const newFile = new File([newFileBlob], `modified_${file.name}`, { type: file.type })

      // Update file state for subsequent actions
      setFile(newFile)

      // Move the change to processed changes and remove from active changes
      const processedChange: ProcessedChange = {
        id: change.id,
        originalChange: change,
        action: action === "accept" ? "accepted" : "rejected",
        proposedText: proposedText,
        processedAt: new Date(),
        reviewerName: reviewerName.trim() || "Anonymous"
      }
      
      setProcessedChanges((prev) => [...prev, processedChange])
      setChanges((prevChanges) => prevChanges.filter((c) => c.id !== change.id))
      setSelectedChangeId(null)
      
      // Clear the proposed text for this change
      setProposedTexts((prev) => {
        const newProposedTexts = { ...prev }
        delete newProposedTexts[change.id]
        return newProposedTexts
      })

      const viewer = documentViewerRef.current
      const mark = viewer?.querySelector("mark")
      const parent = mark?.parentNode

      if (viewer && mark && parent) {
        if (action === "accept") {
          // For proposals, use the proposed text; for original accepts, use the change text
          const finalText = isProposal ? proposedText : change.text
          
          if (change.type === "insertion") {
            parent.replaceChild(document.createTextNode(finalText), mark)
          } else {
            parent.removeChild(mark)
          }
        } else {
          // reject
          if (change.type === "insertion") {
            parent.removeChild(mark)
          } else {
            parent.replaceChild(document.createTextNode(change.text), mark)
          }
        }
        parent.normalize()
        originalTextRef.current = null
      } else {
        // Fallback to full refresh if live DOM manipulation fails
        console.warn("Live update failed, falling back to full refresh.")
        if (documentViewerRef.current) {
          documentViewerRef.current.innerHTML = ""
          await renderAsync(newFile, documentViewerRef.current)
        }
      }
    } catch (e) {
      console.error(e)
      const errorMessage = e instanceof Error ? e.message : "An unknown error occurred"
      setError(`Error: ${errorMessage}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col overflow-hidden">
      <header className="border-b dark:border-gray-700 p-4 bg-white dark:bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Contract Redlining Assistant</h1>
          <div className="flex items-center gap-2">
            {file && (
              <span className="text-sm text-gray-500 dark:text-gray-400 mr-4">
                {file.name}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={triggerFileUpload}>
                  <UploadCloud className="w-4 h-4 mr-2" />
                  Upload Document
                </DropdownMenuItem>
                {file && (
                  <>
                    <DropdownMenuItem onClick={handleReload} disabled={isLoading}>
                      <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
                      Reload Document
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownload}>
                      <Download className="w-4 h-4 mr-2" />
                      Download Reviewed
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".docx" className="hidden" />
          </div>
        </div>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 flex-1 min-h-0 overflow-hidden">
        <aside className="lg:col-span-1 xl:col-span-1 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Document Review</h2>
              {processedChanges.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-xs"
                >
                  <History className="w-3 h-3 mr-1" />
                  {showHistory ? "Hide" : "Show"} History
                </Button>
              )}
            </div>
            
            {/* Reviewer Name Input */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Enter reviewer name..."
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            
            {/* Tab Navigation */}
            <div className="flex border-b dark:border-gray-600 mb-2">
              <button
                onClick={() => setActiveTab("changes")}
                className={cn(
                  "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "changes"
                    ? "border-primary text-primary"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                )}
              >
                Changes ({changes.length})
              </button>
              <button
                onClick={() => setActiveTab("comments")}
                className={cn(
                  "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "comments"
                    ? "border-primary text-primary"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                )}
              >
                Comments ({comments.length})
              </button>
            </div>
            
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeTab === "changes" 
                ? (changes.length > 0 
                    ? `${changes.length} pending changes${processedChanges.length > 0 ? `, ${processedChanges.length} processed` : ""}` 
                    : "No changes found")
                : (comments.length > 0 
                    ? `${comments.length} comments found`
                    : "No comments found")}
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-2">
              {!file && (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <FileText className="w-16 h-16 text-gray-400 mb-4" />
                  <h3 className="font-semibold">No Document Selected</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Use the menu in the header to upload a document.
                  </p>
                </div>
              )}
              
              {(isLoading || isProcessing) && (
                <div className="p-4 text-center">{isProcessing ? "Applying changes..." : "Loading changes..."}</div>
              )}
              
              {error && <div className="p-4 text-red-500">{error}</div>}
              
              {/* Changes Tab Content */}
              {activeTab === "changes" && (
                <div className="space-y-2">
                  {changes.length === 0 && file && (
                    <div className="text-center p-4 text-gray-500 dark:text-gray-400">
                      <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No tracked changes found in this document.</p>
                    </div>
                  )}
                  
                  {changes.length > 0 && sortedSections.length === 0 && (
                    <div className="text-center p-4 text-red-500">
                      <p className="text-sm">Found {changes.length} changes but failed to group them into sections.</p>
                      <p className="text-xs mt-1">This might be a section parsing issue.</p>
                    </div>
                  )}
                  
                  {sortedSections.length > 0 && (
                    <div className="space-y-3">
                      {sortedSections.map(([sectionId, section]) => (
                        <Card key={sectionId} className="border-gray-200 dark:border-gray-700 overflow-hidden">
                          <Collapsible 
                            open={expandedSections.has(sectionId)} 
                            onOpenChange={() => toggleSectionExpansion(sectionId)}
                          >
                            <CollapsibleTrigger asChild>
                              <div className="w-full p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b dark:border-gray-600">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{section.sectionName}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {section.changes.length} change{section.changes.length !== 1 ? 's' : ''}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {section.latestDate && section.latestDate.toLocaleDateString()}
                                    </span>
                                    {expandedSections.has(sectionId) ? (
                                      <ChevronUp className="w-4 h-4 text-gray-500" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-gray-500" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="space-y-2 p-3">
                                {section.changes.map((change) => (
                                  <ChangeCard 
                                    key={change.id}
                                    change={change}
                                    selectedChangeId={selectedChangeId}
                                    proposedTexts={proposedTexts}
                                    isProcessing={isProcessing}
                                    onSelectChange={handleSelectChange}
                                    onProposalChange={handleProposalChange}
                                    onRedlineAction={handleRedlineAction}
                                  />
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            
            {/* Comments Tab Content */}
            {activeTab === "comments" && comments.length > 0 && (
              <div className="space-y-2">
                {comments.map((comment) => (
                  <Card
                    key={comment.id}
                    onClick={() => handleSelectComment(comment)}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      selectedCommentId === comment.id
                        ? "border-primary ring-2 ring-primary"
                        : "border-gray-200 dark:border-gray-700",
                    )}
                  >
                    <CardHeader className="p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            Comment
                          </Badge>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <User size={12} /> 
                              {comment.author}
                              {comment.initials && ` (${comment.initials})`}
                            </div>
                            {comment.date && (
                              <div className="flex items-center gap-1">
                                <Calendar size={12} /> {new Date(comment.date).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <div className="bg-blue-50 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 p-3 rounded-md">
                        <MessageSquare className="w-4 h-4 inline mr-2" />
                        <span className="text-sm">{comment.text}</span>
                      </div>
                      {comment.parentCommentId && (
                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          Reply to comment #{comment.parentCommentId}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            
            {activeTab === "comments" && comments.length === 0 && file && (
              <div className="text-center p-4 text-gray-500 dark:text-gray-400">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No comments found in this document.</p>
              </div>
            )}
              
              {/* History Section */}
              {showHistory && processedChanges.length > 0 && (
                <div className="border-t dark:border-gray-700 pt-4 mt-4 space-y-2">
                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <History className="w-4 h-4" />
                    Change History
                  </h3>
                  {processedChanges.map((processedChange) => (
                    <Card
                      key={`processed-${processedChange.id}`}
                      className="opacity-75 border-gray-300 dark:border-gray-600"
                    >
                      <CardHeader className="p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant={processedChange.originalChange.type === "insertion" ? "default" : "destructive"}>
                                {processedChange.originalChange.type === "insertion" ? "Insertion" : "Deletion"}
                              </Badge>
                              <Badge 
                                variant={processedChange.action === "accepted" ? "default" : "secondary"}
                                className={processedChange.action === "accepted" 
                                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" 
                                  : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"}
                              >
                                {processedChange.action}
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <User size={12} /> {processedChange.originalChange.author}
                              </div>
                              <div className="flex items-center gap-1">
                                <Calendar size={12} /> {processedChange.processedAt.toLocaleDateString()}
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-xs">Reviewed by: {processedChange.reviewerName}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 pt-0">
                        <p
                          className={cn(
                            "text-sm p-2 rounded-md",
                            processedChange.originalChange.type === "insertion"
                              ? "bg-green-50 dark:bg-green-900/50 text-green-800 dark:text-green-200"
                              : "bg-red-50 dark:bg-red-900/50 text-red-800 dark:text-red-200 line-through",
                          )}
                        >
                          {processedChange.originalChange.text}
                        </p>
                        {processedChange.proposedText && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Proposed alternative:</p>
                            <p className="text-sm p-2 rounded-md bg-blue-50 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200">
                              {processedChange.proposedText}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
        <main className="lg:col-span-2 xl:col-span-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              <h2 className="text-lg font-semibold">{file ? file.name : "Document Viewer"}</h2>
            </div>
            {file && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 50}
                  className="h-8 w-8 p-0"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[3rem] text-center">
                  {zoomLevel}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 200}
                  className="h-8 w-8 p-0"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomReset}
                  disabled={zoomLevel === 100}
                  className="h-8 w-8 p-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 md:p-4 lg:p-8">
            <div 
              ref={documentViewerRef} 
              className="docx-container transition-transform duration-200 ease-in-out"
              style={{ 
                transform: `scale(${zoomLevel / 100})`, 
                transformOrigin: 'top left',
                width: `${10000 / zoomLevel}%`
              }}
            >
              {!file && (
                <div className="flex items-center justify-center h-full text-gray-400">
                  Upload a document to view it here.
                </div>
              )}
            </div>
          </div>
        </main>
      </main>
    </div>
  )
}
