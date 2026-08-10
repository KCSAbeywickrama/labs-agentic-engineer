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

// Package text holds string primitives shared across features that would
// otherwise each grow their own copy.
package text

import "strings"

// Truncate returns s cut to at most max BYTES, never through the middle of a
// rune, with an ellipsis appended when it actually cut.
//
// The rune part is the whole reason this exists. Every caller feeds an upstream
// error body into a user-visible message, those bodies carry non-ASCII prose,
// and a plain s[:max] through a multi-byte rune leaves invalid UTF-8 that
// encoding/json re-encodes as U+FFFD — so the reader gets a replacement glyph.
//
// Walking back to a "rune start" does NOT fix it, which is the trap worth
// naming: a LEAD byte satisfies b&0xC0 != 0x80, so `é` cut after its first byte
// passes that test and the result is still invalid. ToValidUTF8 drops the
// incomplete sequence instead.
//
// max is a byte budget, not a character count — callers are bounding payload
// size, and the returned string may hold fewer characters than max.
func Truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return strings.ToValidUTF8(s[:max], "") + "…"
}
