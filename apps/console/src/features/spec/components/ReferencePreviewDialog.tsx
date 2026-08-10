/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Typography,
} from "@wso2/oxygen-ui";
import { MarkdownView } from "../../../components/MarkdownView";
import { useSpecFileContent } from "../api/queries";
import type { SpecFileEntry } from "../api/mapping";
import { base64ToBlob, referenceFileKind, referenceMimeType } from "../lib/referencePreview";

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

// Read-only preview for one uploaded reference document (#383): the row's
// click target in SpecFileList's References section. Deliberately NOT routed
// through SpecView's file-selection pipeline (collab Y.doc text, the
// structured/markdown editor branches) — reference documents are the user's
// static source material, never agent-edited, and a PDF's binary bytes have
// no business anywhere near the collab text editor. A self-contained dialog
// with its own fetch keeps that whole machinery untouched.
export function ReferencePreviewDialog({
  projectName,
  file,
  onClose,
}: {
  projectName: string;
  file: SpecFileEntry | null;
  onClose: () => void;
}) {
  const content = useSpecFileContent(projectName, file);
  const kind = file ? referenceFileKind(file.path) : "text";

  // PDF preview needs an object URL over the DECODED bytes (`content.data` is
  // base64 text for a binary read — the read half of #384's WriteOp.encoding
  // contract). Built when the content arrives, revoked on close/unmount/file
  // change so the blob is never leaked across previews.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "pdf" || !content.data) {
      setPdfUrl(null);
      return;
    }
    const blob = base64ToBlob(content.data.content, referenceMimeType("pdf"));
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the file identity or its content changes, not on every content object identity churn from refetches of the SAME data
  }, [kind, content.data?.content, file?.path]);

  const title = file ? basename(file.path) : "";

  return (
    <Dialog open={file !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent
        dividers
        {...(kind === "pdf" ? { sx: { p: 0, height: "75vh", display: "flex" } } : {})}
      >
        {content.isPending && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6, width: "100%" }}>
            <CircularProgress aria-label={`Loading ${file?.path ?? "reference"}`} />
          </Box>
        )}

        {content.isError && (
          <Alert
            severity="error"
            action={<Button onClick={() => void content.refetch()}>Retry</Button>}
          >
            Failed to load {file?.path}
            {content.error instanceof Error && content.error.message
              ? `: ${content.error.message}`
              : ""}
          </Alert>
        )}

        {content.data && kind === "pdf" && (
          pdfUrl ? (
            <object
              data={pdfUrl}
              type="application/pdf"
              width="100%"
              height="100%"
              aria-label={title}
            >
              {/* Fallback for a browser that refuses inline PDF rendering. */}
              <Box sx={{ p: 3 }}>
                <Typography variant="body2">
                  Your browser can&apos;t preview this PDF inline.{" "}
                  <Link href={pdfUrl} download={title || "document.pdf"}>
                    Download it
                  </Link>{" "}
                  instead.
                </Typography>
              </Box>
            </object>
          ) : (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6, width: "100%" }}>
              <CircularProgress aria-label="Preparing preview" />
            </Box>
          )
        )}

        {content.data && kind === "markdown" && (
          <MarkdownView>{content.data.content}</MarkdownView>
        )}

        {content.data && kind === "text" && (
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: "monospace",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "70vh",
              overflow: "auto",
            }}
          >
            {content.data.content}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
