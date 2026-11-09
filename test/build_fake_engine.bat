@echo off
rem Build the fake engine from THIS folder, wherever it lives.
rem (It used to cd into the scratch dir, so a copy elsewhere silently rebuilt the wrong source.)
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
set CLANG=D:\arby-strata\.rocm-win\Lib\site-packages\_rocm_sdk_devel\lib\llvm\bin\clang++.exe
cd /d "%~dp0"
"%CLANG%" -std=c++20 -O2 -D_DLL -D_MT -Xclang --dependent-lib=msvcrt -fuse-ld=lld-link fake_engine.cpp -o fake_engine.exe 2>&1
echo exit=%errorlevel%
