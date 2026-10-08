#!/usr/bin/env bash
# Builds a real ISO 9660 reference with xorriso, then runs the tests against it.
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm -v "$PWD/..:/w" -w /w/test alpine:3.20 sh -c '
  apk add -q --no-cache xorriso nodejs >/dev/null
  mkdir -p /tmp/t/sub && head -c 3000000 /dev/urandom > /tmp/t/big.dat && echo hello > /tmp/t/sub/hello.txt
  xorriso -as mkisofs -quiet -V TESTDISC -o /tmp/ref.iso /tmp/t 2>/dev/null
  node convert.test.js /tmp/ref.iso'
