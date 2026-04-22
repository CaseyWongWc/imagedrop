import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Paperclip,
  Trash2,
  ExternalLink,
  Upload,
  Loader2,
  Link,
  Unlink,
  X,
} from "lucide-react";
import type { Attachment, TimelineItem } from "@shared/schema";

interface DetailedSummaryRef {
  id: string;
  createdAt: string | Date;
}

// Study guide section names (mirrored from the server constant)
const SG_SECTION_NAMES = [
  "topics",
  "keyConcepts",
  "definitions",
  "workedExamples",
  "practiceQuestions",
  "flaggedGaps",
] as const;
type SgSectionName = (typeof SG_SECTION_NAMES)[number];
const SG_SECTION_LABELS: Record<SgSectionName, string> = {
  topics: "Topics",
  keyConcepts: "Key Concepts",
  definitions: "Definitions",
  workedExamples: "Worked Examples",
  practiceQuestions: "Practice Questions",
  flaggedGaps: "Flagged Gaps",
};

interface StudyGuideRef {
  id: string;
  createdAt: string | Date;
}

interface AttachmentsPanelProps {
  notebookId: string;
  timeline: TimelineItem[];
  detailedSummaries?: DetailedSummaryRef[];
  studyGuides?: StudyGuideRef[];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getTimelineLabel(item: TimelineItem): string {
  const ts = new Date(item.timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (item.type === "image") {
    const img = item.content as { fileName: string };
    return `Photo: ${img.fileName} @ ${ts}`;
  }
  if (item.type === "transcription") {
    const t = item.content as { text: string };
    return `Transcript: ${t.text.slice(0, 40)}… @ ${ts}`;
  }
  if (item.type === "checkpoint") {
    const cp = item.content as { label?: string };
    return `Checkpoint: ${cp.label || "Checkpoint"} @ ${ts}`;
  }
  return `Item @ ${ts}`;
}

async function uploadFileToStorage(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });

  // Normalize the GCS URL to an /objects/... path (same logic as objectStorageService)
  const url = new URL(uploadURL.split("?")[0]);
  const pathname = url.pathname;
  const privateDir = (import.meta.env.VITE_PRIVATE_OBJECT_DIR ?? "").replace(/\/$/, "");
  if (privateDir && pathname.startsWith(privateDir)) {
    return `/objects/${pathname.slice(privateDir.length).replace(/^\//, "")}`;
  }
  // Fallback: extract objectId from path segments
  const parts = pathname.split("/");
  return `/objects/uploads/${parts[parts.length - 1]}`;
}

export function AttachmentsPanel({
  notebookId,
  timeline,
  detailedSummaries: detailedSummariesProp,
  studyGuides: studyGuidesProp,
}: AttachmentsPanelProps) {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; pct: number }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const { data: attachmentsList = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/notebooks", notebookId, "attachments"],
    enabled: !!notebookId,
  });

  // Fetch detailed summaries and study guides for the link picker (lightweight — IDs + createdAt only)
  const { data: detailedSummariesData = [] } = useQuery<DetailedSummaryRef[]>({
    queryKey: ["/api/notebooks", notebookId, "detailed-summaries"],
    enabled: !!notebookId,
    select: (rows: { id: string; createdAt: string | Date }[]) =>
      rows.map((r) => ({ id: r.id, createdAt: r.createdAt })),
  });
  const { data: studyGuidesData = [] } = useQuery<StudyGuideRef[]>({
    queryKey: ["/api/notebooks", notebookId, "study-guides"],
    enabled: !!notebookId,
    select: (rows: { id: string; createdAt: string | Date }[]) =>
      rows.map((r) => ({ id: r.id, createdAt: r.createdAt })),
  });

  // Prefer explicitly passed props (from parent) over internally fetched data
  const detailedSummaries = detailedSummariesProp ?? detailedSummariesData;
  const studyGuides = studyGuidesProp ?? studyGuidesData;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/attachments/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks", notebookId, "attachments"] });
      setDeleteTarget(null);
      toast({ title: "Attachment deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete attachment", variant: "destructive" });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async ({
      id,
      linkedToType,
      linkedToId,
    }: {
      id: string;
      linkedToType: string | null;
      linkedToId: string | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/attachments/${id}/link`, {
        linkedToType,
        linkedToId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks", notebookId, "attachments"] });
      setLinkingId(null);
      toast({ title: "Link updated" });
    },
    onError: () => {
      toast({ title: "Failed to update link", variant: "destructive" });
    },
  });

  const uploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const slot = { name: file.name, pct: 0 };
        setUploading((prev) => [...prev, slot]);
        try {
          const objectPath = await uploadFileToStorage(file, (pct) => {
            setUploading((prev) =>
              prev.map((s) => (s.name === file.name ? { ...s, pct } : s))
            );
          });
          const res = await apiRequest("POST", `/api/notebooks/${notebookId}/attachments`, {
            objectPath,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
          });
          if (!res.ok) throw new Error("Failed to register attachment");
          queryClient.invalidateQueries({
            queryKey: ["/api/notebooks", notebookId, "attachments"],
          });
          toast({ title: `"${file.name}" attached` });
        } catch (err) {
          console.error("Attachment upload error:", err);
          toast({
            title: `Failed to attach "${file.name}"`,
            variant: "destructive",
          });
        } finally {
          setUploading((prev) => prev.filter((s) => s.name !== file.name));
        }
      }
    },
    [notebookId, toast]
  );

  // Drag-and-drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  };

  // Scoped paste handler — only active when the Attachments zone is focused.
  // This avoids conflicting with the global paste-to-capture handler in Home.tsx.
  const handleContainerPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const ext = file.name === "" || file.name === "image.png"
            ? file.type.replace("/", ".").replace("image.", "")
            : "";
          const namedFile = file.name
            ? file
            : new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
          files.push(namedFile);
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  }, [uploadFiles]);

  return (
    <div
      className="border-t mt-6 pt-4 outline-none"
      tabIndex={0}
      onPaste={handleContainerPaste}
      aria-label="Attachments zone — click here, then paste files"
    >
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">Attachments</h3>
        {attachmentsList.length > 0 && (
          <Badge variant="secondary" className="text-xs" data-testid="badge-attachments-count">
            {attachmentsList.length}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="input-attachment-file"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) {
                uploadFiles(files);
                e.target.value = "";
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-attach-file"
          >
            <Upload className="w-3 h-3" />
            <span className="hidden sm:inline">Attach file</span>
          </Button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-md border-2 border-dashed transition-colors cursor-pointer mb-3 py-5 text-center text-xs text-muted-foreground select-none ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"
        }`}
        data-testid="dropzone-attachments"
      >
        {isDragging ? (
          <span>Drop files here</span>
        ) : (
          <span>Drag &amp; drop files here, click to browse, or click here then paste</span>
        )}
      </div>

      {/* In-progress uploads */}
      {uploading.map((u) => (
        <div key={u.name} className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate flex-1">{u.name}</span>
          <span>{u.pct}%</span>
        </div>
      ))}

      {/* Attachment list */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : attachmentsList.length === 0 && uploading.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">No attachments yet.</p>
      ) : (
        <div className="space-y-1">
          {attachmentsList.map((att) => {
            const linkedItem =
              att.linkedToId && (att.linkedToType === "image" || att.linkedToType === "transcription" || att.linkedToType === "checkpoint")
                ? timeline.find((t) => t.id === att.linkedToId)
                : null;
            const linkedSummary =
              att.linkedToId && att.linkedToType === "detailed_summary"
                ? detailedSummaries.find((s) => s.id === att.linkedToId)
                : null;
            // linkedToId for study_guide_section is "{guideId}:{sectionName}"
            const linkedStudyGuide =
              att.linkedToId && att.linkedToType === "study_guide_section"
                ? (() => {
                    const [guideId, sectionName] = att.linkedToId.split(":");
                    const guide = studyGuides.find((s) => s.id === guideId);
                    return guide ? { guide, sectionName } : null;
                  })()
                : null;
            const isLinkingThis = linkingId === att.id;

            return (
              <Card
                key={att.id}
                className="px-3 py-2"
                data-testid={`card-attachment-${att.id}`}
              >
                <div className="flex items-start gap-2">
                  <Paperclip className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a
                        href={att.objectPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium truncate hover:underline"
                        data-testid={`link-attachment-${att.id}`}
                      >
                        {att.fileName}
                      </a>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {humanSize(att.fileSize)}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(att.uploadedAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Linked item info */}
                    {!isLinkingThis && (linkedItem || linkedSummary || linkedStudyGuide) && (
                      <div className="mt-1 flex items-center gap-1">
                        <Badge variant="outline" className="text-xs gap-1">
                          <Link className="w-2.5 h-2.5" />
                          {linkedItem
                            ? getTimelineLabel(linkedItem)
                            : linkedSummary
                            ? `Detailed Summary (${new Date(linkedSummary.createdAt).toLocaleDateString()})`
                            : linkedStudyGuide
                            ? `Study Guide — ${SG_SECTION_LABELS[linkedStudyGuide.sectionName as SgSectionName] ?? linkedStudyGuide.sectionName} (${new Date(linkedStudyGuide.guide.createdAt).toLocaleDateString()})`
                            : ""}
                        </Badge>
                      </div>
                    )}

                    {/* Link picker */}
                    {isLinkingThis && (
                      <div className="mt-1 flex items-center gap-1">
                        <Select
                          value={
                            att.linkedToType === "detailed_summary"
                              ? `ds:${att.linkedToId}`
                              : att.linkedToType === "study_guide_section"
                              ? `sg:${att.linkedToId}` // format: sg:{guideId}:{sectionName}
                              : (att.linkedToId ?? "__none__")
                          }
                          onValueChange={(val) => {
                            if (val === "__none__") {
                              linkMutation.mutate({ id: att.id, linkedToType: null, linkedToId: null });
                            } else if (val.startsWith("ds:")) {
                              linkMutation.mutate({
                                id: att.id,
                                linkedToType: "detailed_summary",
                                linkedToId: val.slice(3),
                              });
                            } else if (val.startsWith("sg:")) {
                              // val is "sg:{guideId}:{sectionName}"
                              // linkedToId stored as "{guideId}:{sectionName}"
                              linkMutation.mutate({
                                id: att.id,
                                linkedToType: "study_guide_section",
                                linkedToId: val.slice(3), // "{guideId}:{sectionName}"
                              });
                            } else {
                              const item = timeline.find((t) => t.id === val);
                              if (item) {
                                linkMutation.mutate({
                                  id: att.id,
                                  linkedToType: item.type,
                                  linkedToId: item.id,
                                });
                              }
                            }
                          }}
                        >
                          <SelectTrigger
                            className="h-7 text-xs flex-1"
                            data-testid={`select-link-${att.id}`}
                          >
                            <SelectValue placeholder="Link to timeline item…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No link</SelectItem>
                            {timeline.length > 0 && (
                              <>
                                {timeline.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {getTimelineLabel(item)}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                            {detailedSummaries.length > 0 && (
                              <>
                                {detailedSummaries.map((s) => (
                                  <SelectItem key={s.id} value={`ds:${s.id}`}>
                                    Detailed Summary ({new Date(s.createdAt).toLocaleDateString()})
                                  </SelectItem>
                                ))}
                              </>
                            )}
                            {studyGuides.length > 0 &&
                              studyGuides.flatMap((sg) =>
                                SG_SECTION_NAMES.map((sectionName) => (
                                  <SelectItem
                                    key={`sg:${sg.id}:${sectionName}`}
                                    value={`sg:${sg.id}:${sectionName}`}
                                  >
                                    Study Guide ({new Date(sg.createdAt).toLocaleDateString()}) — {SG_SECTION_LABELS[sectionName]}
                                  </SelectItem>
                                ))
                              )}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setLinkingId(null)}
                          data-testid={`button-cancel-link-${att.id}`}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Link to timeline item"
                      onClick={() => setLinkingId(isLinkingThis ? null : att.id)}
                      data-testid={`button-link-attachment-${att.id}`}
                    >
                      {att.linkedToId ? (
                        <Unlink className="w-3 h-3" />
                      ) : (
                        <Link className="w-3 h-3" />
                      )}
                    </Button>
                    <a
                      href={att.objectPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      tabIndex={0}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Open attachment"
                        data-testid={`button-open-attachment-${att.id}`}
                        onClick={(e) => e.stopPropagation()}
                        type="button"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      title="Delete attachment"
                      onClick={() => setDeleteTarget(att)}
                      data-testid={`button-delete-attachment-${att.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.fileName}" will be permanently removed from object storage and any
              linked Notion entry will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-attachment">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-attachment"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Inline badge rendered on a timeline item when it has linked attachments
interface AttachmentBadgesProps {
  itemId: string;
  attachments: Attachment[];
  onJumpToPanel: () => void;
  /** When provided, only attachments with this linkedToType are shown. Prevents ID collisions. */
  linkedToType?: string;
}

export function AttachmentBadges({ itemId, attachments, onJumpToPanel, linkedToType }: AttachmentBadgesProps) {
  const linked = attachments.filter((a) => {
    if (a.linkedToId !== itemId) return false;
    if (linkedToType && a.linkedToType !== linkedToType) return false;
    return true;
  });
  if (linked.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1" data-testid={`attachment-badges-${itemId}`}>
      {linked.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={onJumpToPanel}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title={`Attachment: ${a.fileName}`}
          data-testid={`badge-attachment-${a.id}`}
        >
          <Paperclip className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[14ch]">{a.fileName}</span>
        </button>
      ))}
    </div>
  );
}
