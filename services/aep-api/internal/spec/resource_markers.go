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

package spec

// CRTType is spec's own vocabulary for everything design-save reads off one
// installed ClusterResourceType: the PE-authored role / skill / consumer-URL
// markers, and the output names a consumer binds. It is the consumer-side
// projection of the dependencies domain's resource-type catalog, reached through
// the resourceTypeCatalog port and mapped at the composition root — so the spec
// domain names the dependencies feature nowhere (the P2c "a domain names no
// other domain's entity, even in a port" rule). dependencies becomes a domain
// in P8; this stays a port either way.
//
// Markers and Outputs travel together because they are read in the SAME pass off
// the SAME single catalog call: auth derivation keys on the markers, wiring
// derivation keys on the outputs, and splitting them would buy a second OC
// round-trip and a second failure mode for data that arrives in the first one.
type CRTType struct {
	// EndUserAuth is true when the resourceType carries the end-user-auth role
	// marker; design-save derives an end-user-auth dependency from it.
	EndUserAuth bool
	// ConsumerURLEnvConfig is the env-config key to patch the consumer's
	// callback URL into, or "" when the type carries no such annotation.
	ConsumerURLEnvConfig string
	// ConsumerURLPath is the path appended to the consumer's origin for that
	// patch.
	ConsumerURLPath string
	// Skill is the skill name that must appear in skillsApplied, or "".
	Skill string
	// Description is the human prose describing what the type provides, or "".
	Description string
	// Outputs are the names of the values a provisioned binding of this type
	// exposes (e.g. host, port, dbname, user, password), in the order the type
	// declares them. Wiring derivation turns each into the env var OpenChoreo
	// injects it as; an empty list means nothing is bindable, so no wiring is
	// stamped.
	Outputs []string
}
