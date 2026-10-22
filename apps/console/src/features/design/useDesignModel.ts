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
import { useQuery } from "@tanstack/react-query";
import { ADDRESS_COMMENTS_COMMAND, parseDesignCommand, parseRecreateCommand } from "@aep/contracts/commands";
import { env } from "../../config/env";
import { buildPreflightQuery } from "../builds/api/preflight";
import { useProjectChat } from "../agent-chat/useProjectChat";
import { useSpecDoc } from "../spec/collab/specDoc";
import { useRoomFiles } from "../spec/collab/useRoomFiles";
import { useMockDesignModel, type DesignDependency, type DesignModel, type DesignRun } from "./api/designModel";
import { designCatalog } from "./model/catalog";

// The design model (N7, E4). On the platform it is worked out from the room:
// the catalog from the design's files (model/catalog.ts), the dependencies
// that wait on a person from the build preflight, and the design turn running
// now from the chat (a design, or Address comments). The review (comments,
// Checked) is review.json's, read by useDesignReview.
//
// In mock mode the model is the mock's.

const DESIGN_FILES = ["specs/design/", "specs/validation/acceptance/"] as const;

/** The design-review turn an instruction starts, if it is one. */
function runOf(instruction: string | undefined): DesignRun | null {
  if (!instruction) return null;
  if (instruction.trim() === ADDRESS_COMMENTS_COMMAND) return { kind: "address", features: [] };
  // A recreate is a design run over every feature; the card shows it as one.
  if (parseRecreateCommand(instruction) !== null) return { kind: "design", features: [] };
  const design = parseDesignCommand(instruction);
  return design ? { kind: "design", features: design.featureIds } : null;
}

/** The dependencies a person must decide before their features build (E2): one per feature its component serves. */
function dependenciesOf(
  items: { component: string; dependency: string; kind: string; description: string }[],
  componentFeatures: ReadonlyMap<string, string[]>,
): DesignDependency[] {
  return items
    .filter((i) => i.kind === "external-unresolved")
    .flatMap((i) =>
      (componentFeatures.get(i.component) ?? []).map((featureId) => ({
        featureId,
        needs: i.dependency,
        question: i.description,
        why: `${featureId} cannot be built until ${i.dependency} is settled.`,
        options: [],
        answer: null,
      })),
    );
}

export function useDesignModel(projectName: string) {
  const mock = env.apiMode === "mock";
  const mocked = useMockDesignModel(projectName, mock);
  const files = useRoomFiles(useSpecDoc(projectName), DESIGN_FILES);
  const chat = useProjectChat(projectName);
  const preflight = useQuery({ ...buildPreflightQuery(projectName), enabled: !mock });

  const platform = useMemo((): DesignModel | undefined => {
    if (mock) return undefined;
    const artifacts = designCatalog(files);
    const componentFeatures = new Map(
      artifacts.flatMap((a) => (a.source.kind === "contract" ? [[a.id, a.features] as const] : [])),
    );
    return {
      revision: null,
      running: runOf(chat.turn.phase === "idle" ? undefined : chat.turn.instruction),
      artifacts,
      dependencies: dependenciesOf(preflight.data?.items ?? [], componentFeatures),
    };
  }, [mock, files, chat.turn, preflight.data]);

  if (mock) return mocked;
  return {
    data: platform,
    isPending: false,
    isError: preflight.isError,
    error: preflight.error,
    refetch: preflight.refetch,
  };
}
