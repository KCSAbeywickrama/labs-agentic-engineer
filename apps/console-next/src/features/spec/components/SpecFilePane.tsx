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

import { useMemo } from "react";
import { Typography } from "@wso2/oxygen-ui";
import type * as Y from "yjs";
import { EmptyState } from "../../../components/EmptyState";
import type { ProductWideItem, SpecModel } from "../api/specModel";
import { designChangedLines } from "../model/designChanges";
import { fileFragment } from "../collab/specEdits";
import { SpecEditor } from "../collab/SpecEditor";
import type { OpenFile } from "../model/files";
import { stageTone, type FeatureView, type Workspace } from "../model/workspace";
import type { SpecTarget } from "../useSpecWorkspace";
import { BlockingQuestionBox } from "./BlockingQuestionBox";
import { DocKicker } from "./DocKicker";
import { FeatureRows } from "./FeatureRows";
import { NextUp } from "./NextUp";
import { QuietIdText } from "./QuietId";
import { SourceDocumentView } from "./SourceDocumentView";
import { StubNote } from "./StubNote";
import { Tag } from "./Tag";

/** The file's path as the repo shows it under requirements/. */
function shortPath(path: string): string {
  return path.replace(/^requirements\//, "");
}

/** The product-wide items that reach this feature. */
function ProductWideHere({
  featureId,
  items,
  workspace,
  onOpen,
}: {
  featureId: string;
  items: ProductWideItem[];
  workspace: Workspace;
  onOpen: (target: SpecTarget) => void;
}) {
  const here = items.filter((p) => p.appliesTo === "all" || p.appliesTo.includes(featureId));
  if (here.length === 0) return null;
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 2.75, maxWidth: "72ch" }}>
      Product-wide rules that apply here:{" "}
      <QuietIdText text={here.map((p) => p.id).join(", ")} index={workspace.index} onOpen={onOpen} />
    </Typography>
  );
}

function FeatureKicker({ feature }: { feature: FeatureView }) {
  return (
    <DocKicker>
      <span>{feature.id}</span>
      <span>{shortPath(feature.path)}</span>
      <Tag tone={stageTone(feature.stage)}>{feature.stage}</Tag>
      {feature.chips.map((c) => (
        <Tag key={c.label} tone={c.tone}>
          {c.label}
        </Tag>
      ))}
    </DocKicker>
  );
}

/** The open file of the spec card: the product page, a feature, product-wide, or a source document. */
export function SpecFilePane({
  projectName,
  model,
  workspace,
  doc,
  file,
  onOpen,
}: {
  projectName: string;
  model: SpecModel;
  workspace: Workspace;
  doc: Y.Doc;
  file: OpenFile;
  onOpen: (target: SpecTarget) => void;
}) {
  const featureId = file.kind === "feature" ? file.key : null;
  const designChanged = useMemo(
    () => (featureId ? designChangedLines(model.design.specChanges, featureId) : null),
    [model.design.specChanges, featureId],
  );

  if (file.kind === "document") {
    return <SourceDocumentView document={file.document} index={workspace.index} onOpen={onOpen} />;
  }

  const fragment = fileFragment(doc, file.path);
  if (!fragment) {
    return <EmptyState bordered compact description={`${shortPath(file.path)} isn't in the spec yet.`} />;
  }
  const editorProps = { fragment, path: file.path, files: workspace.files, index: workspace.index, onOpen };

  if (file.kind === "product") {
    return (
      <>
        {!workspace.small && <NextUp items={workspace.nextUp} features={workspace.features} projectName={projectName} />}
        <DocKicker>
          <span>prd.md</span>
          <span>the product frame and its features</span>
        </DocKicker>
        <SpecEditor
          key={file.path}
          {...editorProps}
          featureRows={<FeatureRows projectName={projectName} features={workspace.features} />}
          hideFog={workspace.small}
        />
      </>
    );
  }

  if (file.kind === "product-wide") {
    return (
      <>
        <DocKicker>
          <span>product-wide.md</span>
          <span>rules that apply to more than one feature</span>
        </DocKicker>
        <SpecEditor key={file.path} {...editorProps} />
      </>
    );
  }

  const feature = workspace.features.find((f) => f.id === file.key) ?? {
    ...file.feature,
    chips: [],
    blocking: [],
    toConfirm: 0,
    designOutOfDate: false,
  };
  return (
    <>
      <FeatureKicker feature={feature} />
      <SpecEditor key={file.path} {...editorProps} designChanged={designChanged} />
      {feature.blocking.length > 0 ? (
        feature.blocking.map((q) => <BlockingQuestionBox key={q.question} doc={doc} feature={feature} blocking={q} />)
      ) : (
        (feature.stage === "Not interviewed" || feature.stage === "Interviewing") && (
          <StubNote projectName={projectName} feature={feature} />
        )
      )}
      <ProductWideHere featureId={feature.id} items={workspace.productWide} workspace={workspace} onOpen={onOpen} />
    </>
  );
}
