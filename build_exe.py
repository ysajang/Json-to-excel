#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
EXE 빌드 스크립트
pyinstaller를 사용하여 EXE 파일 생성
"""

import subprocess
import sys
import os

def build_exe():
    """EXE 파일 빌드"""
    print("EXE 파일 빌드 시작...")

    # pyinstaller 명령어 구성
    cmd = [
        "pyinstaller",
        "--onefile",  # 단일 EXE 파일로 생성
        "--windowed",  # 콘솔 창 숨김 (GUI만 표시)
        "--name=CSV_JSON_Converter",  # EXE 파일 이름
        "--icon=NONE",  # 아이콘 없음 (필요시 추가 가능)
        "--add-data=logs;logs",  # logs 폴더 포함 (필요시)
        "csv_json_converter.py"
    ]

    try:
        subprocess.run(cmd, check=True)
        print("\n빌드 완료!")
        print("dist 폴더에 CSV_JSON_Converter.exe 파일이 생성되었습니다.")
    except subprocess.CalledProcessError as e:
        print(f"\n빌드 실패: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print("\n오류: pyinstaller가 설치되지 않았습니다.")
        print("다음 명령어로 설치하세요: pip install pyinstaller")
        sys.exit(1)


if __name__ == "__main__":
    build_exe()
