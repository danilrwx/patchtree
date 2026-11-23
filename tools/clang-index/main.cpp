// Copyright 2026 Daniil Antoshin
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#include "clang/AST/ASTContext.h"
#include "clang/Index/IndexDataConsumer.h"
#include "clang/Index/IndexingAction.h"
#include "clang/Index/USRGeneration.h"
#include "clang/Lex/Lexer.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

using namespace clang;

namespace {
class Occurrences : public index::IndexDataConsumer {
  ASTContext *Context = nullptr;
  std::shared_ptr<Preprocessor> PP;

  void emit(llvm::StringRef USR, index::SymbolRoleSet Roles,
            SourceLocation Loc) {
    if (Loc.isInvalid())
      return;
    const auto &SM = PP->getSourceManager();
    if (Loc.isMacroID()) {
      // A macro body can expand into several different declarations. Only a
      // spelled token, including the argument at the call site, is clickable.
      if (!SM.isMacroArgExpansion(Loc))
        return;
      Loc = SM.getSpellingLoc(Loc);
    }
    const auto [FID, Offset] = SM.getDecomposedLoc(Loc);
    const auto File = SM.getFileEntryRefForID(FID);
    if (!File || !File->getName().starts_with("/repo/"))
      return;
    const auto Width = Lexer::MeasureTokenLength(Loc, SM, PP->getLangOpts());
    if (Width == 0)
      return;
    const auto HasRole = [&](index::SymbolRole Role) {
      return (Roles & static_cast<index::SymbolRoleSet>(Role)) != 0;
    };
    const int Kind = HasRole(index::SymbolRole::Definition) ? 2 :
                     HasRole(index::SymbolRole::Declaration) ? 1 : 0;
    llvm::json::Array Row{File->getName().drop_front(6).str(), Offset, Width,
                          Kind, USR.str()};
    llvm::outs() << llvm::json::Value(std::move(Row)) << '\n';
  }

public:
  void initialize(ASTContext &Ctx) override { Context = &Ctx; }

  void setPreprocessor(std::shared_ptr<Preprocessor> P) override {
    PP = std::move(P);
  }

  bool handleDeclOccurrence(const Decl *D, index::SymbolRoleSet Roles,
                            llvm::ArrayRef<index::SymbolRelation>,
                            SourceLocation Loc, ASTNodeInfo) override {
    llvm::SmallString<128> USR;
    if (Context && !index::generateUSRForDecl(D, USR)) {
      // Clang USRs use a basename for local and internal linkage symbols.
      // Include the full file path to avoid collisions across directories.
      if (const auto *Named = dyn_cast<NamedDecl>(D);
          Named && !Named->isExternallyVisible()) {
        const auto &SM = Context->getSourceManager();
        const auto DeclLoc = SM.getSpellingLoc(D->getCanonicalDecl()->getLocation());
        if (DeclLoc.isValid()) {
          USR += "@";
          USR += SM.getFilename(DeclLoc);
        }
      }
      emit(USR, Roles, Loc);
    }
    return true;
  }

  bool handleMacroOccurrence(const IdentifierInfo *Name, const MacroInfo *MI,
                             index::SymbolRoleSet Roles,
                             SourceLocation Loc) override {
    const auto &SM = PP->getSourceManager();
    const auto Def = MI->getDefinitionLoc();
    if (Def.isValid() && SM.getFilename(Def).starts_with("/repo/")) {
      llvm::SmallString<128> USR;
      if (!index::generateUSRForMacro(Name->getName(), Def, SM, USR)) {
        USR += "@";
        USR += SM.getFilename(Def);
        emit(USR, Roles, Loc);
      }
    }
    return true;
  }
};
int run(std::vector<std::string> Args) {
  index::IndexingOptions Options;
  Options.IndexFunctionLocals = true;
  Options.IndexParametersInDeclarations = true;
  Options.IndexTemplateParameters = true;
  Options.SystemSymbolFilter = index::IndexingOptions::SystemSymbolFilterKind::All;
  auto Consumer = std::make_shared<Occurrences>();
  auto Action = index::createIndexingAction(Consumer, Options);
  IntrusiveRefCntPtr<FileManager> Files(new FileManager(FileSystemOptions{}));
  tooling::ToolInvocation Tool(std::move(Args), std::move(Action), Files.get());
  const bool OK = Tool.run();
  llvm::outs().flush();
  return OK ? 0 : 1;
}
} // namespace

#ifdef __EMSCRIPTEN__
extern "C" EMSCRIPTEN_KEEPALIVE int patchtree_index(const char *Command) {
  auto Parsed = llvm::json::parse(Command);
  if (!Parsed) {
    llvm::consumeError(Parsed.takeError());
    return 1;
  }
  const auto *Arguments = Parsed->getAsArray();
  if (!Arguments)
    return 1;
  std::vector<std::string> Args{"/clang/bin/clang"};
  for (const auto &Arg : *Arguments) {
    auto Text = Arg.getAsString();
    if (!Text)
      return 1;
    Args.push_back(Text->str());
  }
  return run(std::move(Args));
}
#else
int main(int Argc, const char **Argv) {
  return run(std::vector<std::string>(Argv, Argv + Argc));
}
#endif
