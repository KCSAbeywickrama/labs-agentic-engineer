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

package agentsvc

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// The signed token backdates nbf below iat so a verifier whose clock trails
// ours by a fraction of a second still accepts it (no not-yet-valid 401 on S2S
// turn dispatch).
func TestHS256Signer_NBFBackdatedBelowIAT(t *testing.T) {
	raw, err := newHS256Signer("secret", "agents-service", "aep-bff").sign()
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	tok, err := jwt.Parse(raw, func(*jwt.Token) (any, error) { return []byte("secret"), nil })
	if err != nil || !tok.Valid {
		t.Fatalf("parse/verify: %v", err)
	}

	iat, err := tok.Claims.GetIssuedAt()
	if err != nil || iat == nil {
		t.Fatalf("iat missing: %v", err)
	}
	nbf, err := tok.Claims.GetNotBefore()
	if err != nil || nbf == nil {
		t.Fatalf("nbf missing: %v", err)
	}

	if !nbf.Time.Before(iat.Time) {
		t.Fatalf("nbf %v is not before iat %v — clock-skew tolerance absent", nbf.Time, iat.Time)
	}
	if skew := iat.Time.Sub(nbf.Time); skew < nbfSkew {
		t.Fatalf("nbf backdated by %v, want >= %v", skew, nbfSkew)
	}
}
