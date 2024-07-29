#! /usr/bin/env python3
# Usage:
#    build-idl.py latest/2.0/webgl2.idl
import os
import pathlib
import subprocess
import sys

OUT_IDL = pathlib.Path(sys.argv[1])
INDEX_HTML = OUT_IDL.parent / 'index.html'
assert INDEX_HTML.exists(), INDEX_HTML

BASE_DIR = pathlib.Path(__file__).parent.parent
assert (BASE_DIR / '.git').exists(), BASE_DIR / '.git'

# -
# Extract the idl from index.html.

PYTHONPATH_LIBS = [
   BASE_DIR / 'resources/html5lib-1.1/src/html5lib',
   BASE_DIR / 'resources/webencodings-0.5.1/src/webencodings',
]
for lib in PYTHONPATH_LIBS:
   assert lib.exists(), lib
PYTHONPATH = os.pathsep.join([str(lib.parent) for lib in PYTHONPATH_LIBS])

ENV = os.environ
ENV['PYTHONPATH'] = PYTHONPATH

args = [sys.executable, BASE_DIR / 'specs/extract-idl.py', INDEX_HTML]
print(f'Running {args}...')
p = subprocess.run(args, env=ENV, stdout=subprocess.PIPE, text=True)
p.check_returncode()
idl = p.stdout
assert '\r' not in idl

idl_file_data = '''\
// AUTOGENERATED FILE -- DO NOT EDIT -- SEE Makefile
//
// WebGL IDL definitions scraped from the Khronos specification:
// https://www.khronos.org/registry/webgl/specs/latest/
''' + idl

print(f'Writing "{OUT_IDL}"...')
OUT_IDL.write_bytes(idl_file_data.encode())
