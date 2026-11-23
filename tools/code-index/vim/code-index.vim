" Copyright 2026 Daniil Antoshin
"
" Licensed under the Apache License, Version 2.0 (the "License");
" you may not use this file except in compliance with the License.
" You may obtain a copy of the License at
"
"     http:"www.apache.org/licenses/LICENSE-2.0
"
" Unless required by applicable law or agreed to in writing, software
" distributed under the License is distributed on an "AS IS" BASIS,
" WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
" See the License for the specific language governing permissions and
" limitations under the License.

if exists('g:loaded_code_index')
  finish
endif
let g:loaded_code_index = 1
let s:cache = {}

function! s:Tag(pattern, flags, info) abort
  return [s:destination]
endfunction

function! s:Definition() abort
  try
    let source = resolve(expand('%:p'))
    let index = findfile('code-index.json', escape(fnamemodify(source, ':h'), ' ,;') . ';')
    if empty(index)
      throw 'Code index file not found'
    endif
    let index = fnamemodify(index, ':p')
    let root = fnamemodify(index, ':h') . '/'
    let stamp = [index, getftime(index), getfsize(index)]
    if get(s:cache, 'stamp', []) !=# stamp
      let data = json_decode(join(readfile(index), "\n"))
      if type(data) != v:t_dict || get(data, 'version', 0) !=# 1 || type(get(data, 'files', 0)) != v:t_dict
        throw 'Invalid code index'
      endif
      let s:cache = {'stamp': stamp, 'data': data}
    endif
    let data = s:cache.data
    let revision = trim(system('git -C ' . shellescape(root) . ' rev-parse HEAD 2>/dev/null'))
    if v:shell_error || revision !=# get(data, 'revision', '')
      throw 'Code index belongs to a different revision'
    endif
    let path = strpart(source, strlen(root))
    let row = get(get(data.files, path, {}), string(line('.')), {})
    if get(row, 'text', v:null) !=# getline('.')
      throw 'No matching code index entry for this line'
    endif
    let offset = col('.') - 1
    let seen = {}
    let targets = []
    for span in row.spans
      if offset < span.start || offset >= span.end
        continue
      endif
      for target in span.targets
        let key = json_encode(target)
        if !has_key(seen, key)
          let seen[key] = 1
          call add(targets, target)
        endif
      endfor
    endfor
    if empty(targets)
      throw 'No indexed definition under cursor'
    endif
    let choice = len(targets) == 1 ? 1 : inputlist(['Go to definition:'] +
          \ map(copy(targets), {i, t -> printf('%d. %s:%d', i+1, strtrans(t.path), t.line)}))
    if choice < 1 || choice > len(targets)
      return
    endif
    let target = targets[choice - 1]
    let filename = root . target.path
    if target.path =~# '\(^\|/\)\.\{1,2}\(/\|$\)' || target.path =~# '^/\|\\\|[[:cntrl:]]' ||
          \ !has_key(data.files, target.path) || resolve(filename) !=# filename ||
          \ target.line < 1 || target.column < 0 || !filereadable(filename)
      throw 'Invalid target in code index'
    endif
    let destination = get(get(data.files, target.path, {}), string(target.line), {})
    let actual = bufloaded(filename) ? getbufline(filename, target.line) : readfile(filename, '', target.line)[target.line - 1 :]
    if get(actual, 0, v:null) !=# get(destination, 'text', '')
      throw 'Destination differs from the indexed source'
    endif
    let origin = bufnr()
    let previous = &l:tagfunc
    let name = expand('<cword>')
    let s:destination = {'name': name, 'filename': filename, 'cmd': string(target.line)}
    let &l:tagfunc = expand('<SID>') . 'Tag'
    try
      execute 'tag ' . (empty(name) ? 'definition' : fnameescape(name))
      call cursor(target.line, target.column + 1)
    finally
      call setbufvar(origin, '&tagfunc', previous)
    endtry
  catch
    echohl WarningMsg
    echomsg v:exception
    echohl None
  endtry
endfunction

command! CodeIndexDefinition call s:Definition()
nnoremap <silent> <Plug>(CodeIndexDefinition) :CodeIndexDefinition<CR>
