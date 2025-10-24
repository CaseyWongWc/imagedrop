import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

interface LinkCopyFieldProps {
  url: string;
  label?: string;
}

export function LinkCopyField({ url, label = "Image URL" }: LinkCopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <Input
          value={url}
          readOnly
          className="font-mono text-sm"
          data-testid="input-image-url"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={copyToClipboard}
          className="shrink-0"
          data-testid="button-copy-url"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
