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

package k8sname_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
)

// rfc1123Label is the character set a name may use if it is to survive being
// copied into a label value: lowercase alphanumerics and dashes, starting and
// ending alphanumeric.
var rfc1123Label = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// TestBoundedRespectsBudget is the property the whole helper exists for: no
// input, however long, may produce a name over the caller's budget. The
// incident this replaces was a name ONE character over a 63-char limit, so the
// test sweeps adversarial lengths rather than checking a single happy case.
func TestBoundedRespectsBudget(t *testing.T) {
	for _, budget := range []int{63, 60, 49, 32, 12, 9, 8, 4, 1, 0} {
		for _, n := range []int{0, 1, 8, 40, 200, 5000} {
			long := strings.Repeat("a", n)
			for _, segs := range [][]k8sname.Segment{
				{k8sname.Capped(long, 18)},
				{k8sname.Capped(long, 18), k8sname.Capped(long, 18), k8sname.Whole("4b4fede2508f")},
				{k8sname.Whole(long)},
			} {
				got := k8sname.Bounded(budget, segs...)
				if len(got) > budget {
					t.Errorf("Bounded(%d) with %d-char segs = %q (%d chars), over budget",
						budget, n, got, len(got))
				}
				if got != "" && !rfc1123Label.MatchString(got) {
					t.Errorf("Bounded(%d) = %q, not a valid RFC 1123 label", budget, got)
				}
			}
		}
	}
}

// TestBoundedIsInjectiveUnderTruncation is the reason the digest is worth its
// characters. Two components whose names agree well past the cap must not
// collapse to one name: a caller deriving identity from the name (counting a
// component's build attempts by prefix, say) would otherwise silently merge two
// different components, which is far harder to notice than a length error.
func TestBoundedIsInjectiveUnderTruncation(t *testing.T) {
	const budget = 60
	const project = "invoicing-freelancers-creates621"

	seen := map[string]string{}
	components := []string{
		"invoicing-webapp",
		"invoicing-webapp-admin",
		"invoicing-webapp-admin-portal",
		"invoicing-webapp-admin-portal-v2",
		// Differs only past the 18-char cap.
		"a-very-long-compo-one",
		"a-very-long-compo-two",
	}
	for _, c := range components {
		got := k8sname.Bounded(budget,
			k8sname.Capped(project, 18),
			k8sname.Capped(c, 18),
			k8sname.Whole("4b4fede2508f"),
		)
		if prior, dup := seen[got]; dup {
			t.Errorf("components %q and %q both produced %q — truncation collided", prior, c, got)
		}
		seen[got] = c
	}
}

// TestBoundedNeverTruncatesWholeSegments pins that Whole means whole: the commit
// is the part of a build name humans actually read, so it must survive even when
// the rest of the head is cut down to fit.
func TestBoundedNeverTruncatesWholeSegments(t *testing.T) {
	const sha = "4b4fede2508f"
	got := k8sname.Bounded(60,
		k8sname.Capped(strings.Repeat("p", 200), 18),
		k8sname.Capped(strings.Repeat("c", 200), 18),
		k8sname.Whole(sha),
	)
	if !strings.Contains(got, sha) {
		t.Errorf("Bounded = %q, want the whole commit %q to survive truncation", got, sha)
	}
}

// TestBoundedIsDeterministic pins that write side and read side, which compose
// the name independently, agree — including when one of them recovered a segment
// from a Kubernetes label and so passes it already sanitized.
func TestBoundedIsDeterministic(t *testing.T) {
	call := func(project, component string) string {
		return k8sname.Bounded(60,
			k8sname.Capped(project, 18),
			k8sname.Capped(component, 18),
			k8sname.Whole("4b4fede2508f"),
		)
	}
	base := call("shop", "api")
	if again := call("shop", "api"); again != base {
		t.Errorf("Bounded is not deterministic: %q then %q", base, again)
	}
	// Sanitizing is applied before hashing, so a caller holding the un-normalized
	// form composes the same name as one holding the label's version.
	if mixed := call("Shop", "API"); mixed != base {
		t.Errorf("Bounded(%q) = %q, want the sanitized form %q", "Shop/API", mixed, base)
	}
}

// TestBoundedDropsEmptySegments pins that an absent segment contributes nothing
// rather than the "component" fallback ToK8sName substitutes — a composed name
// must not grow a phantom word.
func TestBoundedDropsEmptySegments(t *testing.T) {
	got := k8sname.Bounded(60, k8sname.Capped("", 18), k8sname.Capped("api", 18))
	if strings.Contains(got, "component") {
		t.Errorf("Bounded = %q, want no 'component' fallback for an empty segment", got)
	}
	if !strings.HasPrefix(got, "api-") {
		t.Errorf("Bounded = %q, want it to lead with the segment that was present", got)
	}
}

// TestBoundedShape pins the composed form for the exact project/component pair
// that overflowed in production, so a reader can see what these names look like
// without running a build, and so a change to the widths or the digest shows up
// as a diff here rather than as a surprise in the cluster.
func TestBoundedShape(t *testing.T) {
	const want = "invoicing-freelanc-invoicing-webapp-4b4fede2508f-80ca1f42"
	got := k8sname.Bounded(60,
		k8sname.Capped("invoicing-freelancers-creates621", 18),
		k8sname.Capped("invoicing-webapp", 18),
		k8sname.Whole("4b4fede2508f"),
	)
	if got != want {
		t.Errorf("Bounded = %q (%d chars), want %q", got, len(got), want)
	}
}
