"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import { type DocxChange, extractChanges } from "@/lib/docx-parser"
import { renderAsync } from "docx-preview"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { UploadCloud, FileText, MessageSquare, Check, X, User, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export default function ContractRedlinePage() {
  const [file, setFile] = useState<File | null>(null)
  const [changes, setChanges] = useState<DocxChange[]>([])
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [proposedTexts, setProposedTexts] = useState<Record<string, string>>({})

  const documentViewerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const originalTextRef = useRef<string | null>(null)

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
    setSelectedChangeId(null)
    setProposedTexts({})
    try {
      const extracted = await extractChanges(uploadedFile)
      setChanges(extracted)
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
    highlightTextInViewer(change.text)
  }

  const handleProposalChange = (changeId: string, text: string) => {
    setProposedTexts((prev) => ({ ...prev, [changeId]: text }))
  }

  const triggerFileUpload = () => {
    fileInputRef.current?.click()
  }

  const handleRedlineAction = async (change: DocxChange, action: "accept" | "reject") => {
    if (!file) return
    setIsProcessing(true)
    setError(null)

    const proposedText = proposedTexts[change.id]
    const isProposal = action === "accept" && typeof proposedText === "string" && proposedText.trim() !== ""

    const formData = new FormData()
    formData.append("file", file)
    formData.append("changeId", change.id)
    formData.append("changeType", change.type)
    formData.append("action", action)
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

      // If it was a proposal, we must do a full refresh to see the new change in the list
      if (isProposal) {
        setSelectedChangeId(null)
        setProposedTexts({})
        const extracted = await extractChanges(newFile)
        setChanges(extracted)
        if (documentViewerRef.current) {
          documentViewerRef.current.innerHTML = ""
          await renderAsync(newFile, documentViewerRef.current)
        }
      } else {
        // Otherwise, use the fast-path DOM update for simple accept/reject
        setChanges((prevChanges) => prevChanges.filter((c) => c.id !== change.id))
        setSelectedChangeId(null)

        const viewer = documentViewerRef.current
        const mark = viewer?.querySelector("mark")
        const parent = mark?.parentNode

        if (viewer && mark && parent) {
          if (action === "accept") {
            if (change.type === "insertion") {
              parent.replaceChild(document.createTextNode(change.text), mark)
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="border-b dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <h1 className="text-2xl font-bold">Contract Redlining Assistant</h1>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 h-[calc(100vh-73px)]">
        <aside className="lg:col-span-1 xl:col-span-1 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 flex flex-col">
          <div className="p-4 border-b dark:border-gray-700">
            <h2 className="text-lg font-semibold">Document Changes</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {changes.length > 0 ? `${changes.length} changes detected` : "Upload a document to begin"}
            </p>
          </div>
          <div className="flex-grow overflow-y-auto p-2 space-y-2">
            {!file && (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <UploadCloud className="w-16 h-16 text-gray-400 mb-4" />
                <h3 className="font-semibold">Upload a redlined contract</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Click the button below to select a .docx file.
                </p>
                <Button onClick={triggerFileUpload}>
                  <UploadCloud className="w-4 h-4 mr-2" />
                  Upload Document
                </Button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".docx" className="hidden" />
              </div>
            )}
            {(isLoading || isProcessing) && (
              <div className="p-4 text-center">{isProcessing ? "Applying changes..." : "Loading changes..."}</div>
            )}
            {error && <div className="p-4 text-red-500">{error}</div>}
            {changes.map((change) => (
              <Card
                key={change.id}
                onClick={() => handleSelectChange(change)}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
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
                        <MessageSquare size={16} /> Collaboration
                      </h4>
                      <Textarea
                        placeholder="Propose alternative text..."
                        className="text-sm"
                        value={proposedTexts[change.id] || ""}
                        onChange={(e) => handleProposalChange(change.id, e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRedlineAction(change, "accept")}
                          disabled={isProcessing}
                        >
                          <Check className="w-4 h-4 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRedlineAction(change, "reject")}
                          disabled={isProcessing}
                        >
                          <X className="w-4 h-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </aside>
        <main className="lg:col-span-2 xl:col-span-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            <h2 className="text-lg font-semibold">{file ? file.name : "Document Viewer"}</h2>
          </div>
          <div className="flex-grow overflow-y-auto p-2 md:p-4 lg:p-8">
            <div ref={documentViewerRef} className="docx-container">
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
