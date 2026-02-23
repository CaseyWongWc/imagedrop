import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Notebook, Image, InsertImage, TimelineItem } from "@shared/schema";
import { UploadZone } from "@/components/UploadZone";
import { CameraCapture } from "@/components/CameraCapture";
import { RecordingBar } from "@/components/RecordingBar";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Trash2,
  Plus,
  Download,
  Loader2,
  Settings,
  BookOpen,
  Flag,
  ZoomIn,
  ZoomOut,
  Type,
  Camera,
  Mic,
  FolderOpen,
  Upload,
  FileText,
  Pencil,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import heic2any from "heic2any";

export default function Home() {
  const { toast } = useToast();
  
  // Notebook state
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(() => {
    return localStorage.getItem("selected-notebook-id");
  });
  const [createNotebookOpen, setCreateNotebookOpen] = useState(false);
  const [newNotebookTitle, setNewNotebookTitle] = useState("");
  const [newNotebookClass, setNewNotebookClass] = useState("");
  
  // UI state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRecordingRequested, setIsRecordingRequested] = useState(false);
  const [editNotebookOpen, setEditNotebookOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editClassName, setEditClassName] = useState("");
  
  // Display controls with localStorage persistence
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("font-size");
    return saved ? parseInt(saved) : 14;
  });
  const [photoScale, setPhotoScale] = useState(() => {
    const saved = localStorage.getItem("photo-scale");
    return saved ? parseInt(saved) : 100;
  });
  
  // Auto checkpoint timer
  const [autoCheckpointEnabled, setAutoCheckpointEnabled] = useState(() => {
    const saved = localStorage.getItem("auto-checkpoint-enabled");
    return saved === "true";
  });
  const [autoCheckpointMinutes, setAutoCheckpointMinutes] = useState(() => {
    const saved = localStorage.getItem("auto-checkpoint-minutes");
    return saved ? parseInt(saved) : 5;
  });
  const lastActivityRef = useRef<Date>(new Date());
  const checkpointTimerRef = useRef<NodeJS.Timeout | null>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  
  // Detect mobile for native camera usage (SSR-safe)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem("font-size", fontSize.toString());
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("photo-scale", photoScale.toString());
  }, [photoScale]);

  useEffect(() => {
    localStorage.setItem("auto-checkpoint-enabled", autoCheckpointEnabled.toString());
  }, [autoCheckpointEnabled]);

  useEffect(() => {
    localStorage.setItem("auto-checkpoint-minutes", autoCheckpointMinutes.toString());
  }, [autoCheckpointMinutes]);

  // Paste handler for clipboard images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!selectedNotebookId) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            // Create a new file with a proper name since clipboard files have generic names
            const timestamp = Date.now();
            const ext = file.type.split("/")[1] || "png";
            const namedFile = new File([file], `pasted-${timestamp}.${ext}`, { type: file.type });
            imageFiles.push(namedFile);
          }
        }
      }
      
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFileUpload(imageFiles);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [selectedNotebookId]);

  useEffect(() => {
    if (selectedNotebookId) {
      localStorage.setItem("selected-notebook-id", selectedNotebookId);
    } else {
      localStorage.removeItem("selected-notebook-id");
    }
  }, [selectedNotebookId]);

  // Queries
  const { data: notebooks = [], isLoading: isLoadingNotebooks } = useQuery<Notebook[]>({
    queryKey: ["/api/notebooks"],
  });

  const { data: timeline = [], isLoading: isLoadingTimeline } = useQuery<TimelineItem[]>({
    queryKey: ["/api/notebooks", selectedNotebookId, "timeline"],
    enabled: !!selectedNotebookId,
  });

  // Find selected notebook
  const selectedNotebook = notebooks.find(n => n.id === selectedNotebookId);

  // Mutations
  const createNotebookMutation = useMutation({
    mutationFn: async (data: { title: string; className?: string }) => {
      return await apiRequest("POST", "/api/notebooks", data);
    },
    onSuccess: async (res) => {
      const notebook = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setSelectedNotebookId(notebook.id);
      setCreateNotebookOpen(false);
      setNewNotebookTitle("");
      setNewNotebookClass("");
      toast({
        title: "Notebook created",
        description: `"${notebook.title}" is ready`,
      });
    },
  });

  const deleteNotebookMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/notebooks/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setSelectedNotebookId(null);
      setDeleteAllDialogOpen(false);
      toast({
        title: "Notebook deleted",
        description: "All content has been removed",
      });
    },
  });

  const updateNotebookMutation = useMutation({
    mutationFn: async ({ id, title, className }: { id: string; title: string; className: string }) => {
      return await apiRequest("PATCH", `/api/notebooks/${id}`, { title, className: className || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setEditNotebookOpen(false);
      toast({
        title: "Notebook updated",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (imageData: InsertImage) => {
      return await apiRequest("POST", "/api/images", imageData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks", selectedNotebookId, "timeline"] });
      lastActivityRef.current = new Date();
    },
  });

  const createCheckpointMutation = useMutation({
    mutationFn: async (label?: string) => {
      return await apiRequest("POST", "/api/checkpoints", {
        notebookId: selectedNotebookId,
        label,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks", selectedNotebookId, "timeline"] });
      toast({
        title: "Checkpoint saved",
        description: new Date().toLocaleTimeString(),
      });
    },
  });

  // Auto checkpoint timer
  useEffect(() => {
    if (!autoCheckpointEnabled || !selectedNotebookId) {
      if (checkpointTimerRef.current) {
        clearInterval(checkpointTimerRef.current);
      }
      return;
    }

    const checkInterval = setInterval(() => {
      const now = new Date();
      const minutesSinceActivity = (now.getTime() - lastActivityRef.current.getTime()) / 1000 / 60;
      
      if (minutesSinceActivity >= autoCheckpointMinutes) {
        createCheckpointMutation.mutate("Auto checkpoint");
        lastActivityRef.current = now;
      }
    }, 60000); // Check every minute

    checkpointTimerRef.current = checkInterval;

    return () => {
      if (checkpointTimerRef.current) {
        clearInterval(checkpointTimerRef.current);
      }
    };
  }, [autoCheckpointEnabled, autoCheckpointMinutes, selectedNotebookId]);

  // Helper functions
  const convertHeicToPng = async (file: File): Promise<File> => {
    const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                   file.name.toLowerCase().endsWith('.heif') ||
                   file.type === 'image/heic' ||
                   file.type === 'image/heif';
    
    if (!isHeic) return file;

    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/png",
        quality: 0.9,
      });
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      const newFileName = file.name.replace(/\.heic$/i, '.png').replace(/\.heif$/i, '.png');
      return new File([blob], newFileName, {
        type: "image/png",
        lastModified: Date.now(),
      });
    } catch (error) {
      console.error("HEIC conversion error:", error);
      throw new Error("Failed to convert HEIC/HEIF file");
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleFileUpload = async (files: File[]) => {
    if (!selectedNotebookId) {
      toast({
        title: "No notebook selected",
        description: "Please select or create a notebook first",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      for (const file of files) {
        let processedFile = file;
        
        try {
          processedFile = await convertHeicToPng(file);
        } catch {
          toast({
            title: "Conversion failed",
            description: "Could not convert HEIC/HEIF file",
            variant: "destructive",
          });
          continue;
        }

        const uploadUrlRes = await apiRequest("POST", "/api/objects/upload", undefined);
        const uploadUrlData = await uploadUrlRes.json() as { uploadURL: string };

        await fetch(uploadUrlData.uploadURL, {
          method: "PUT",
          body: processedFile,
          headers: { "Content-Type": processedFile.type },
        });

        const url = new URL(uploadUrlData.uploadURL);
        const objectId = url.pathname.split("/").pop()?.split("?")[0] || "";

        const imageData: InsertImage = {
          id: objectId,
          notebookId: selectedNotebookId,
          objectPath: `/objects/uploads/${objectId}`,
          fileName: processedFile.name,
          fileSize: formatFileSize(processedFile.size),
          mimeType: processedFile.type,
        };

        await uploadMutation.mutateAsync(imageData);

        const fullUrl = `${window.location.origin}${imageData.objectPath}`;
        await navigator.clipboard.writeText(fullUrl);

        // Auto-download the photo to the local device
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const ext = processedFile.name.split(".").pop() || "jpg";
          const downloadName = `imagedrop-${timestamp}.${ext}`;
          const downloadUrl = URL.createObjectURL(processedFile);
          const downloadLink = document.createElement("a");
          downloadLink.href = downloadUrl;
          downloadLink.download = downloadName;
          downloadLink.style.display = "none";
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
          URL.revokeObjectURL(downloadUrl);
        } catch {
          // Silent fail - download is a bonus, not critical
        }

        toast({
          title: "Photo captured!",
          description: "Saved to device & link copied",
        });
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleExportLinks = async () => {
    if (timeline.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Add some content first",
      });
      return;
    }

    setIsExporting(true);

    try {
      const baseUrl = window.location.origin;
      
      const markdown = `# ${selectedNotebook?.title || "Notebook"}\n\n${
        selectedNotebook?.className ? `**Class:** ${selectedNotebook.className}\n\n` : ""
      }**Exported:** ${new Date().toLocaleString()}\n\n---\n\n${
        timeline.map((item) => {
          const timestamp = new Date(item.timestamp).toLocaleString();
          if (item.type === "image") {
            const img = item.content as Image;
            return `### ${timestamp}\n\n![${img.fileName}](${baseUrl}${img.objectPath})\n`;
          } else if (item.type === "transcription") {
            const trans = item.content as { text: string };
            return `### ${timestamp}\n\n${trans.text}\n`;
          } else {
            const cp = item.content as { label?: string };
            return `---\n\n**Checkpoint${cp.label ? `: ${cp.label}` : ""}** - ${timestamp}\n\n---\n`;
          }
        }).join("\n")
      }`;

      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedNotebook?.title || "notebook"}-${new Date().toISOString().split("T")[0]}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export complete!",
        description: "Markdown file with photo links downloaded",
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // No notebook selected - show notebook selector
  if (!selectedNotebookId) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
          <div className="container max-w-4xl mx-auto px-4 h-16 flex items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-primary-foreground" />
              </div>
              <h1 className="text-xl font-bold" data-testid="text-app-title">ImageDrop V2</h1>
            </div>
          </div>
        </header>

        <main className="container max-w-4xl mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Select a Notebook</h2>
            <p className="text-muted-foreground">Choose an existing notebook or create a new one</p>
          </div>

          <div className="grid gap-4 mb-6">
            {isLoadingNotebooks ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : notebooks.length === 0 ? (
              <Card className="p-8 text-center">
                <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No notebooks yet</p>
                <Button onClick={() => setCreateNotebookOpen(true)} data-testid="button-create-first-notebook">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Notebook
                </Button>
              </Card>
            ) : (
              notebooks.map((notebook) => (
                <Card
                  key={notebook.id}
                  className="p-4 cursor-pointer hover-elevate"
                  onClick={() => setSelectedNotebookId(notebook.id)}
                  data-testid={`card-notebook-${notebook.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{notebook.title}</h3>
                      {notebook.className && (
                        <Badge variant="secondary" className="mt-1">{notebook.className}</Badge>
                      )}
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(notebook.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <BookOpen className="w-5 h-5 text-muted-foreground" />
                  </div>
                </Card>
              ))
            )}
          </div>

          {notebooks.length > 0 && (
            <div className="text-center">
              <Button onClick={() => setCreateNotebookOpen(true)} data-testid="button-create-notebook">
                <Plus className="w-4 h-4 mr-2" />
                New Notebook
              </Button>
            </div>
          )}
        </main>

        {/* Create Notebook Dialog */}
        <Dialog open={createNotebookOpen} onOpenChange={setCreateNotebookOpen}>
          <DialogContent data-testid="dialog-create-notebook">
            <DialogHeader>
              <DialogTitle>Create New Notebook</DialogTitle>
              <DialogDescription>Start a new lecture capture session</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="notebook-title">Title</Label>
                <Input
                  id="notebook-title"
                  placeholder="Feb 5, 2026 Lecture"
                  value={newNotebookTitle}
                  onChange={(e) => setNewNotebookTitle(e.target.value)}
                  data-testid="input-notebook-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notebook-class">Class (optional)</Label>
                <Input
                  id="notebook-class"
                  placeholder="CS4800"
                  value={newNotebookClass}
                  onChange={(e) => setNewNotebookClass(e.target.value)}
                  data-testid="input-notebook-class"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateNotebookOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createNotebookMutation.mutate({
                  title: newNotebookTitle || `Notebook ${new Date().toLocaleDateString()}`,
                  className: newNotebookClass || undefined,
                })}
                disabled={createNotebookMutation.isPending}
                data-testid="button-confirm-create-notebook"
              >
                {createNotebookMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Notebook selected - show timeline
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedNotebookId(null)}
              data-testid="button-back-to-notebooks"
            >
              <BookOpen className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h1 className="text-sm font-semibold truncate" data-testid="text-notebook-title">
                  {selectedNotebook?.title}
                </h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    if (selectedNotebook) {
                      setEditTitle(selectedNotebook.title);
                      setEditClassName(selectedNotebook.className || "");
                      setEditNotebookOpen(true);
                    }
                  }}
                  data-testid="button-edit-notebook"
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              </div>
              {selectedNotebook?.className && (
                <Badge variant="outline" className="text-xs">{selectedNotebook.className}</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              data-testid="button-settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExportLinks}
              disabled={isExporting || timeline.length === 0}
              data-testid="button-export"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteAllDialogOpen(true)}
              data-testid="button-delete-notebook"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Controls bar */}
        <div className="border-t bg-muted/30 px-4 py-2">
          <div className="container max-w-4xl mx-auto flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-muted-foreground" />
              <Slider
                value={[fontSize]}
                onValueChange={([v]) => setFontSize(v)}
                min={10}
                max={24}
                step={1}
                className="w-20"
                data-testid="slider-font-size"
              />
              <span className="text-xs text-muted-foreground w-6">{fontSize}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <ZoomIn className="w-4 h-4 text-muted-foreground" />
              <Slider
                value={[photoScale]}
                onValueChange={([v]) => setPhotoScale(v)}
                min={25}
                max={100}
                step={5}
                className="w-20"
                data-testid="slider-photo-scale"
              />
              <span className="text-xs text-muted-foreground w-8">{photoScale}%</span>
            </div>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {timeline.length} item{timeline.length !== 1 && "s"}
            </span>
          </div>
        </div>
      </header>

      {/* Timeline */}
      <main className="container max-w-4xl mx-auto px-4 py-4">
        {isLoadingTimeline ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="text-center py-16">
            <Camera className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-semibold mb-2">Ready to capture</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Take photos and record transcripts to build your timeline
            </p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="timeline-container" style={{ fontSize: `${fontSize}px` }}>
            {timeline.map((item) => {
              if (item.type === "image") {
                const img = item.content as Image;
                return (
                  <div
                    key={`image-${item.id}`}
                    className="rounded-lg border overflow-hidden bg-card"
                    data-testid={`card-image-${item.id}`}
                  >
                    <img
                      src={img.objectPath}
                      alt={img.fileName}
                      className="w-full h-auto"
                      style={{ maxWidth: `${photoScale}%` }}
                      loading="lazy"
                    />
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">
                        {formatTime(item.timestamp)}
                      </span>
                      <span className="text-muted-foreground text-xs truncate max-w-[50%]">
                        {img.fileName}
                      </span>
                    </div>
                  </div>
                );
              } else if (item.type === "transcription") {
                const trans = item.content as { text: string };
                return (
                  <div
                    key={`trans-${item.id}`}
                    className="p-3 bg-muted/30 rounded-lg border"
                    data-testid={`card-transcription-${item.id}`}
                  >
                    <p className="whitespace-pre-wrap">{trans.text}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatTime(item.timestamp)}
                    </p>
                  </div>
                );
              } else {
                const cp = item.content as { label?: string };
                return (
                  <div
                    key={`checkpoint-${item.id}`}
                    className="flex items-center gap-2 py-2"
                    data-testid={`card-checkpoint-${item.id}`}
                  >
                    <Separator className="flex-1" />
                    <Badge variant="outline" className="gap-1">
                      <Flag className="w-3 h-3" />
                      {cp.label || "Checkpoint"}
                      <span className="text-muted-foreground">
                        {formatTime(item.timestamp)}
                      </span>
                    </Badge>
                    <Separator className="flex-1" />
                  </div>
                );
              }
            })}
          </div>
        )}
      </main>

      {/* Hidden inputs for media picker */}
      <input
        type="file"
        ref={nativeCameraRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileUpload(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
        data-testid="input-native-camera"
      />
      <input
        type="file"
        ref={photosInputRef}
        className="hidden"
        accept="image/*,.heic,.heif"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileUpload(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
        data-testid="input-photos"
      />

      {/* Bottom Action Bar - icon-only on mobile, labels on larger screens */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur z-40">
        <div className="container max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-2">
          <Button
            size="icon"
            onClick={() => {
              if (isMobile) {
                nativeCameraRef.current?.click();
              } else {
                setCameraOpen(true);
              }
            }}
            disabled={isUploading}
            aria-label="Take photo"
            data-testid="button-camera"
          >
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => photosInputRef.current?.click()}
            disabled={isUploading}
            aria-label="Upload photo"
            data-testid="button-upload"
          >
            <Upload className="w-5 h-5" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setIsRecordingRequested(true)}
            aria-label="Start recording"
            data-testid="button-record"
          >
            <Mic className="w-5 h-5" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => createCheckpointMutation.mutate(undefined)}
            disabled={createCheckpointMutation.isPending}
            aria-label="Create checkpoint"
            data-testid="button-checkpoint"
          >
            {createCheckpointMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Flag className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Camera Modal */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => handleFileUpload([file])}
      />

      {/* Recording Bar - modified to pass notebookId */}
      <RecordingBar
        notebookId={selectedNotebookId}
        isRecordingRequested={isRecordingRequested}
        onRecordingStarted={() => setIsRecordingRequested(false)}
        onTranscribed={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/notebooks", selectedNotebookId, "timeline"] });
          lastActivityRef.current = new Date();
        }}
      />

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent data-testid="dialog-settings">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-checkpoint">Auto Checkpoint</Label>
                <Switch
                  id="auto-checkpoint"
                  checked={autoCheckpointEnabled}
                  onCheckedChange={setAutoCheckpointEnabled}
                  data-testid="switch-auto-checkpoint"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Automatically create a checkpoint after {autoCheckpointMinutes} minutes of inactivity
              </p>
              {autoCheckpointEnabled && (
                <div className="flex items-center gap-2 pt-2">
                  <Label className="text-sm">Minutes:</Label>
                  <Select
                    value={autoCheckpointMinutes.toString()}
                    onValueChange={(v) => setAutoCheckpointMinutes(parseInt(v))}
                  >
                    <SelectTrigger className="w-20" data-testid="select-auto-checkpoint-minutes">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="15">15</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Notebook Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-notebook">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{selectedNotebook?.title}" and all its photos, transcriptions, and checkpoints.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedNotebookId && deleteNotebookMutation.mutate(selectedNotebookId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteNotebookMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Notebook Dialog */}
      <Dialog open={editNotebookOpen} onOpenChange={setEditNotebookOpen}>
        <DialogContent data-testid="dialog-edit-notebook">
          <DialogHeader>
            <DialogTitle>Edit Notebook</DialogTitle>
            <DialogDescription>Change the title or class label for this notebook.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="e.g. Lecture 3"
                data-testid="input-edit-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Class (optional)</Label>
              <Input
                value={editClassName}
                onChange={(e) => setEditClassName(e.target.value)}
                placeholder="e.g. CS4990"
                data-testid="input-edit-classname"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (selectedNotebookId && editTitle.trim()) {
                  updateNotebookMutation.mutate({
                    id: selectedNotebookId,
                    title: editTitle.trim(),
                    className: editClassName.trim(),
                  });
                }
              }}
              disabled={!editTitle.trim() || updateNotebookMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateNotebookMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
