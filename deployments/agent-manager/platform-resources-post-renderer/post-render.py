#!/usr/bin/env python3
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

"""Helm post-renderer for Agent Manager's platform-resources chart.

It reconciles two objects that chart renders with what is already AEP's on a
converged cluster:

1. It prefixes Agent Manager's forked ClusterWorkflowTemplates, so OpenChoreo
   keeps its own (below).
2. It drops Agent Manager's ProjectType/default, which AEP's platform chart
   owns (see PROJECT TYPE, further down).

FORKED BUILD TEMPLATES
----------------------
Agent Manager's platform-resources chart carries its own forks of five of
OpenChoreo's build templates and names them after OpenChoreo's own:

    ballerina-buildpack-build  checkout-source  containerfile-build
    gcp-buildpacks-build       publish-image

OpenChoreo puts those five on the cluster first — setup-env-for-aectl.sh
applies them from the getting-started samples, client-side — so they hold no
Helm ownership metadata, and Helm will not adopt an object it did not create:

    Unable to continue with install: ClusterWorkflowTemplate "checkout-source"
    in namespace "" exists and cannot be imported into the current release:
    invalid ownership metadata

Annotating the five over to the release is the other way past that error, and
it is the wrong one. The forks are not equivalent: Agent Manager's
checkout-source handles basic auth only where OpenChoreo's also handles
ssh-privatekey, so adopting it drops SSH support from every AEP build. It also
leaves the git image on a mutable tag and deletes .git from the workspace.
Renaming Agent Manager's copies keeps AEP's build pipeline as it is.

The chart already names its generate-workload fork `amp-generate-workload`;
this applies that convention to the five it does not. The upstream fix is for
the chart to name them that way itself, which is why this runs as a
--post-renderer rather than as a patch carried in this repo: the objects stay
inside the Helm release, and the day the chart prefixes them the rename finds
nothing and this file goes.

WHAT MAY MOVE, AND WHAT MAY NOT
-------------------------------
Each of these names appears in three roles inside one ClusterWorkflow:

    - name: publish-image            # the step
      templateRef:
        name: publish-image          # the ClusterWorkflowTemplate  <- only this
        template: publish-image      # a template inside that object

Only templateRef.name names the object being renamed, and the rename is safe
precisely because the other two do not move. The step name is what the
workflow's own `steps.publish-image.outputs...` references resolve against, and
is the likelier source of the task names a WorkflowRun reports — aep-api
matches on those (internal/delivery/codingagent/build_auth.go looks for
"checkout-source"), and because the step and the template share that name there,
nothing in the code settles which of them it reads. Leaving both alone means it
does not have to be settled. The inner template belongs to the renamed object's
own spec.

A textual substitution would rewrite all three, which is why this walks the
structure instead.

Nothing outside the release reaches these five. ComponentTypes list
allowedWorkflows by `kind: ClusterWorkflow`, and Agent Manager's own service
addresses build workflows by ClusterWorkflow name (amp-docker,
amp-ballerina-buildpack, amp-google-cloud-buildpacks) — none of which this
touches.

PROJECT TYPE
------------
Both products reference a namespaced ProjectType/default in the org namespace:
Agent Manager's service compiles the name in, and aep-api sends it on every
project create because that is what the wso2cloud org bootstrap seeds.
AEP's platform chart renders it (localOrgProvisioning, the local stand-in for
that bootstrap), and it is installed before this release, so Agent Manager's
copy would stop the install with "invalid ownership metadata". The two are the
same object, so this one is dropped, and the release consumes AEP's.

It is dropped only while its spec is the one AEP's chart renders. If Agent
Manager's ever differs, the install stops here rather than silently running
Agent Manager's projects on a type it did not ship.

Helm passes the rendered manifests on stdin and reads the result from stdout.
"""

import os
import sys

import yaml

# The five forks that collide with OpenChoreo's own templates.
# amp-generate-workload is absent deliberately: the chart already prefixes it.
FORKED = frozenset(
    {
        "ballerina-buildpack-build",
        "checkout-source",
        "containerfile-build",
        "gcp-buildpacks-build",
        "publish-image",
    }
)

PREFIX = "amp-"

# What a correct render of the pinned chart yields. A mismatch means the chart
# changed shape, and the rename is then no longer the one this file describes.
EXPECTED_RENAMES = 5
EXPECTED_REFS = 9


# AEP's copy, relative to this file's real path. Helm 4 installs this
# directory as a symlink to the checkout, so the path resolves there too.
AEP_PROJECT_TYPE = os.path.join(
    os.path.dirname(os.path.realpath(__file__)),
    "..", "..", "helm-charts", "platform", "templates",
    "openchoreo-org-types", "projecttype-default.yaml",
)


def aep_project_type_spec():
    """The spec AEP's chart renders for ProjectType/default.

    The template's only Helm directives are its gate and the namespace, each on
    a line of its own, so dropping those lines leaves plain YAML.
    """
    with open(AEP_PROJECT_TYPE) as f:
        lines = [line for line in f if "{{" not in line]
    return yaml.safe_load("".join(lines))["spec"]


def is_project_type_default(doc):
    return doc.get("kind") == "ProjectType" and (doc.get("metadata") or {}).get("name") == "default"


def renamed(name):
    return PREFIX + name


def rewrite_template_refs(node):
    """Rewrite templateRef.name in place wherever it names a forked template.

    Only the `name` under a `templateRef` mapping is touched. `template` names
    a template inside the referenced object, and a step's own `name` is a
    sibling of templateRef rather than a child of it.
    """
    count = 0
    if isinstance(node, dict):
        ref = node.get("templateRef")
        if isinstance(ref, dict) and ref.get("name") in FORKED:
            ref["name"] = renamed(ref["name"])
            count += 1
        for value in node.values():
            count += rewrite_template_refs(value)
    elif isinstance(node, list):
        for item in node:
            count += rewrite_template_refs(item)
    return count


def main():
    docs = [doc for doc in yaml.safe_load_all(sys.stdin) if doc]

    project_types = [doc for doc in docs if is_project_type_default(doc)]
    if len(project_types) != 1:
        print(
            "post-renderer: expected Agent Manager's chart to render one "
            "ProjectType/default, got {}. Re-check the PROJECT TYPE section of "
            "{}.".format(len(project_types), __file__),
            file=sys.stderr,
        )
        return 1
    if project_types[0].get("spec") != aep_project_type_spec():
        print(
            "post-renderer: Agent Manager's ProjectType/default no longer matches "
            "AEP's ({}). Dropping it would run Agent Manager's projects on a type "
            "it did not ship; reconcile the two first.".format(AEP_PROJECT_TYPE),
            file=sys.stderr,
        )
        return 1
    docs = [doc for doc in docs if not is_project_type_default(doc)]

    renames = 0
    refs = 0
    for doc in docs:
        metadata = doc.get("metadata") or {}
        if doc.get("kind") == "ClusterWorkflowTemplate" and metadata.get("name") in FORKED:
            metadata["name"] = renamed(metadata["name"])
            renames += 1
        refs += rewrite_template_refs(doc)

    # Refuse rather than install a release whose shape is not the one above:
    # too few renames leaves a collision, and a rename nothing points at
    # leaves Agent Manager's workflows referencing templates it no longer
    # declares. Either way the failure lands later and reads as something else.
    if (renames, refs) != (EXPECTED_RENAMES, EXPECTED_REFS):
        print(
            "post-renderer: expected {} rename(s) and {} templateRef rewrite(s), "
            "got {} and {}. The chart's build templates have changed — re-check "
            "FORKED and the expected counts in {}.".format(
                EXPECTED_RENAMES, EXPECTED_REFS, renames, refs, __file__
            ),
            file=sys.stderr,
        )
        return 1

    print(
        "   post-renderer: {} forked template(s) prefixed, {} templateRef(s) "
        "rewritten, ProjectType/default left to AEP's chart".format(renames, refs),
        file=sys.stderr,
    )

    yaml.safe_dump_all(
        docs,
        sys.stdout,
        default_flow_style=False,
        sort_keys=False,
        width=10**9,  # never fold a line: these documents embed shell scripts
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
