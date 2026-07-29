// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package k8sname

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// MaxLabelValueLen is the Kubernetes limit on a label VALUE.
//
// This — not the 253-char limit on a resource NAME — is the budget that binds
// any name a controller copies into a label, and two independent systems do
// exactly that to a build's name:
//
//   - OpenChoreo's workflowrun-controller stamps it into
//     `openchoreo.dev/workflowrun` on the resources it renders for the run.
//   - Argo stamps it into `workflows.argoproj.io/workflow` on every pod.
//
// Overflowing it is silent and total: the WorkflowRun is ACCEPTED (its own name
// is well inside the 253-char name budget), then the render that would create
// the Argo Workflow fails validation, so no build pod is ever created and the
// run sits at WorkflowPending forever with nothing on its status to say why.
// Because Argo caps it too, fixing this upstream in OpenChoreo would not lift
// the budget — treat 63 as structural.
const MaxLabelValueLen = 63

// digestLen is the width of the disambiguating digest Bounded appends. Eight
// hex characters is 32 bits, which is many orders of magnitude more than the
// hundreds of names any one project generates, and it only has to break ties
// between inputs whose readable heads already collided.
const digestLen = 8

// Segment is one readable part of a bounded name.
type Segment struct {
	Value string
	// Max caps this segment's readable contribution. Zero means "never
	// truncate": use it for the parts whose whole value is what makes the name
	// worth reading, such as a commit SHA.
	Max int
}

// Whole returns a Segment that is never truncated.
func Whole(v string) Segment { return Segment{Value: v} }

// Capped returns a Segment whose readable contribution is at most max chars.
func Capped(v string, max int) Segment { return Segment{Value: v, Max: max} }

// Bounded composes a deterministic, RFC 1123 name identifying segs that is
// never longer than budget, and appends a digest of the UNTRUNCATED segments.
//
// The digest is the point. Truncating names to fit a budget is otherwise unsafe
// in a way that fails silently and late: two components whose names agree on
// their first Max characters would produce the same name, and any caller that
// derives identity from that name — counting a component's build attempts by
// matching its name prefix, say — would silently merge two different things.
// Appending a digest of the full input makes truncation lossy for HUMANS while
// keeping the name injective for MACHINES, so callers may cap segments as hard
// as their budget requires without inventing a correctness risk.
//
// budget is the caller's whole allowance for the returned string. A caller that
// appends its own suffix must subtract it (separator included) before calling,
// so that the composed result is bounded by construction rather than by anyone
// remembering to check afterwards.
func Bounded(budget int, segs ...Segment) string {
	digest := identityDigest(segs)
	// The digest carries injectivity, so it is the last thing sacrificed: a
	// budget too small to hold a readable head still yields a distinct name.
	if budget <= digestLen {
		if budget < 0 {
			return ""
		}
		return digest[:min(budget, digestLen)]
	}

	parts := make([]string, 0, len(segs))
	for _, s := range segs {
		v := sanitize(s.Value)
		if s.Max > 0 && len(v) > s.Max {
			v = strings.Trim(v[:s.Max], "-")
		}
		if v != "" {
			parts = append(parts, v)
		}
	}

	// room is what is left for the readable head once the digest and the
	// separator joining it are paid for.
	room := budget - digestLen - 1
	readable := strings.Join(parts, "-")
	if len(readable) > room {
		readable = readable[:room]
	}
	readable = strings.Trim(readable, "-")
	if readable == "" {
		return digest
	}
	return readable + "-" + digest
}

// identityDigest hashes the segments' sanitized values, NUL-separated.
//
// Sanitized, because the read side of a name contract may recover a segment
// from a Kubernetes label (already reduced to the RFC 1123 character set) while
// the write side passes the original: hashing the sanitized form is what makes
// those two agree. NUL-separated, because concatenation alone is ambiguous —
// ("ab", "c") and ("a", "bc") must not hash alike, or two distinct identities
// would share a digest.
func identityDigest(segs []Segment) string {
	h := sha256.New()
	for _, s := range segs {
		h.Write([]byte(sanitize(s.Value)))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))[:digestLen]
}
