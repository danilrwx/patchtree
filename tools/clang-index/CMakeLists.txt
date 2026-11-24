# Copyright 2026 Daniil Antoshin
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

add_clang_tool(patchtree-clang main.cpp)
clang_target_link_libraries(patchtree-clang PRIVATE clangIndex clangTooling)
target_link_options(patchtree-clang PRIVATE
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker,node
  -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,ccall -sFORCE_FILESYSTEM=1
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824
  -sSTACK_SIZE=4194304 -sDYNAMIC_EXECUTION=0)
