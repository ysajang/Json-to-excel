#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
CSV ↔ JSON 변환 프로그램 (다중 파일 지원)
CSV를 JSON/텍스트로, JSON을 CSV로 변환하는 GUI 프로그램
"""

import csv
import json
import logging
import os
import sys
import tkinter as tk
from datetime import datetime
from pathlib import Path
from threading import Thread
from tkinter import filedialog, messagebox, scrolledtext, ttk

import pandas as pd
from openpyxl.utils import get_column_letter

# 로깅 설정
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)
log_file = log_dir / \
    f"converter_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


class CSVJSONConverter:
    def __init__(self, root):
        self.root = root
        self.root.title("CSV ↔ JSON 변환기 (다중 파일 지원)")
        self.root.geometry("900x800")
        self.root.resizable(True, True)

        # 변수 초기화
        self.input_files = []  # 파일 경로 리스트
        self.output_dir = tk.StringVar()
        self.conversion_type = tk.StringVar(value="csv_to_json")
        self.is_converting = False
        self.use_same_dir = True
        self.use_same_dir_var = None

        logger.info("프로그램 시작")
        self.create_ui()

    def create_ui(self):
        """UI 생성"""
        # 메인 프레임
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

        # 변환 타입 선택
        type_frame = ttk.LabelFrame(main_frame, text="변환 타입 선택", padding="10")
        type_frame.grid(row=0, column=0, columnspan=2,
                        sticky=(tk.W, tk.E), pady=5)

        ttk.Radiobutton(
            type_frame,
            text="CSV → JSON",
            variable=self.conversion_type,
            value="csv_to_json",
            command=self.on_type_change
        ).grid(row=0, column=0, padx=10, sticky=tk.W)

        ttk.Radiobutton(
            type_frame,
            text="CSV → 텍스트",
            variable=self.conversion_type,
            value="csv_to_text",
            command=self.on_type_change
        ).grid(row=0, column=1, padx=10, sticky=tk.W)

        ttk.Radiobutton(
            type_frame,
            text="CSV → XLSX",
            variable=self.conversion_type,
            value="csv_to_xlsx",
            command=self.on_type_change
        ).grid(row=0, column=2, padx=10, sticky=tk.W)

        ttk.Radiobutton(
            type_frame,
            text="JSON → CSV",
            variable=self.conversion_type,
            value="json_to_csv",
            command=self.on_type_change
        ).grid(row=0, column=3, padx=10, sticky=tk.W)

        # 입력 파일 목록
        input_frame = ttk.LabelFrame(main_frame, text="입력 파일 목록", padding="10")
        input_frame.grid(row=1, column=0, columnspan=2,
                         sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)

        # 파일 리스트박스와 스크롤바
        list_frame = ttk.Frame(input_frame)
        list_frame.grid(row=0, column=0, columnspan=3,
                        sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)

        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.file_listbox = tk.Listbox(
            list_frame, height=8, yscrollcommand=scrollbar.set)
        self.file_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.file_listbox.yview)

        # 파일 선택 버튼들
        button_frame = ttk.Frame(input_frame)
        button_frame.grid(row=1, column=0, columnspan=3, pady=5)

        ttk.Button(button_frame, text="파일 추가",
                   command=self.add_files).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="선택 항목 제거",
                   command=self.remove_selected_file).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="전체 제거",
                   command=self.clear_files).pack(side=tk.LEFT, padx=5)

        input_frame.columnconfigure(0, weight=1)
        input_frame.rowconfigure(0, weight=1)

        # 출력 폴더 선택
        output_frame = ttk.LabelFrame(main_frame, text="출력 폴더", padding="10")
        output_frame.grid(row=2, column=0, columnspan=2,
                          sticky=(tk.W, tk.E), pady=5)

        ttk.Entry(output_frame, textvariable=self.output_dir, width=60).grid(
            row=0, column=0, padx=5, sticky=(tk.W, tk.E)
        )
        ttk.Button(output_frame, text="폴더 선택", command=self.select_output_dir).grid(
            row=0, column=1, padx=5
        )
        self.use_same_dir_var = tk.BooleanVar(value=True)
        self.use_same_dir_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(output_frame, text="원본 파일과 같은 폴더에 저장",
                        variable=self.use_same_dir_var,
                        command=self.toggle_output_dir).grid(row=1, column=0, columnspan=2, sticky=tk.W, pady=5)
        output_frame.columnconfigure(0, weight=1)

        # 옵션 설정
        self.options_frame = ttk.LabelFrame(
            main_frame, text="옵션", padding="10")
        self.options_frame.grid(
            row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)

        self.encoding_var = tk.StringVar(value="utf-8")
        self.delimiter_var = tk.StringVar(value=",")
        self.pretty_print_var = tk.BooleanVar(value=True)

        ttk.Label(self.options_frame, text="인코딩:").grid(
            row=0, column=0, padx=5, sticky=tk.W)
        encoding_combo = ttk.Combobox(self.options_frame, textvariable=self.encoding_var,
                                      values=["utf-8", "utf-8-sig", "cp949", "euc-kr"], width=15)
        encoding_combo.grid(row=0, column=1, padx=5, sticky=tk.W)

        ttk.Label(self.options_frame, text="구분자:").grid(
            row=0, column=2, padx=5, sticky=tk.W)
        delimiter_combo = ttk.Combobox(self.options_frame, textvariable=self.delimiter_var,
                                       values=[",", ";", "\t"], width=10)
        delimiter_combo.grid(row=0, column=3, padx=5, sticky=tk.W)

        ttk.Checkbutton(self.options_frame, text="예쁘게 출력 (JSON만)",
                        variable=self.pretty_print_var).grid(row=0, column=4, padx=5, sticky=tk.W)

        # 진행 상황 표시
        progress_frame = ttk.LabelFrame(main_frame, text="진행 상황", padding="10")
        progress_frame.grid(row=4, column=0, columnspan=2,
                            sticky=(tk.W, tk.E), pady=5)

        self.progress_var = tk.StringVar(value="대기 중...")
        ttk.Label(progress_frame, textvariable=self.progress_var).grid(
            row=0, column=0, sticky=tk.W)

        self.progress_bar = ttk.Progressbar(progress_frame, mode='determinate')
        self.progress_bar.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=5)
        progress_frame.columnconfigure(0, weight=1)

        # 결과 로그 영역
        log_frame = ttk.LabelFrame(main_frame, text="변환 결과", padding="10")
        log_frame.grid(row=5, column=0, columnspan=2,
                       sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)

        self.log_text = scrolledtext.ScrolledText(
            log_frame, height=12, width=80, wrap=tk.WORD)
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        # 버튼 영역
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=6, column=0, columnspan=2, pady=10)

        self.convert_btn = ttk.Button(
            button_frame, text="일괄 변환 시작", command=self.start_batch_convert, width=20)
        self.convert_btn.pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="초기화", command=self.reset,
                   width=20).pack(side=tk.LEFT, padx=5)

        # 상태바
        self.status_var = tk.StringVar(value="준비됨")
        status_bar = ttk.Label(
            main_frame, textvariable=self.status_var, relief=tk.SUNKEN)
        status_bar.grid(row=7, column=0, columnspan=2,
                        sticky=(tk.W, tk.E), pady=5)

        # 그리드 가중치 설정
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(1, weight=1)
        main_frame.rowconfigure(5, weight=1)

        self.on_type_change()
        self.log_message("프로그램이 시작되었습니다. 파일을 추가하고 변환을 시작하세요.")

    def toggle_output_dir(self):
        """출력 폴더 사용 여부 토글"""
        self.use_same_dir = self.use_same_dir_var.get()
        if self.use_same_dir:
            self.output_dir.set("")

    def on_type_change(self):
        """변환 타입 변경 시 호출"""
        conv_type = self.conversion_type.get()
        logger.info(f"변환 타입 변경: {conv_type}")

        # 옵션 프레임 표시/숨김
        if conv_type in ["csv_to_json", "csv_to_text", "csv_to_xlsx"]:
            self.options_frame.grid()
        else:
            self.options_frame.grid_remove()

    def add_files(self):
        """파일 추가"""
        conv_type = self.conversion_type.get()

        if conv_type in ["csv_to_json", "csv_to_text", "csv_to_xlsx"]:
            filetypes = [("CSV 파일", "*.csv"), ("모든 파일", "*.*")]
            title = "CSV 파일 선택 (다중 선택 가능)"
        else:
            filetypes = [("JSON 파일", "*.json"), ("모든 파일", "*.*")]
            title = "JSON 파일 선택 (다중 선택 가능)"

        filenames = filedialog.askopenfilenames(
            title=title,
            filetypes=filetypes
        )

        if filenames:
            added_count = 0
            for filename in filenames:
                if filename not in self.input_files:
                    self.input_files.append(filename)
                    self.file_listbox.insert(
                        tk.END, os.path.basename(filename))
                    added_count += 1
                    logger.info(f"파일 추가: {filename}")

            self.log_message(f"{added_count}개 파일이 추가되었습니다.")
            self.status_var.set(f"총 {len(self.input_files)}개 파일 선택됨")

    def remove_selected_file(self):
        """선택된 파일 제거"""
        selection = self.file_listbox.curselection()
        if not selection:
            messagebox.showwarning("경고", "제거할 파일을 선택해주세요.")
            return

        # 역순으로 제거 (인덱스가 변경되지 않도록)
        for index in reversed(selection):
            removed_file = self.input_files.pop(index)
            self.file_listbox.delete(index)
            logger.info(f"파일 제거: {removed_file}")

        self.log_message(f"{len(selection)}개 파일이 제거되었습니다.")
        self.status_var.set(f"총 {len(self.input_files)}개 파일 선택됨")

    def clear_files(self):
        """전체 파일 제거"""
        if not self.input_files:
            return

        count = len(self.input_files)
        self.input_files.clear()
        self.file_listbox.delete(0, tk.END)
        logger.info(f"전체 {count}개 파일 제거")
        self.log_message(f"전체 {count}개 파일이 제거되었습니다.")
        self.status_var.set("준비됨")

    def select_output_dir(self):
        """출력 폴더 선택"""
        dirname = filedialog.askdirectory(title="출력 폴더 선택")
        if dirname:
            self.output_dir.set(dirname)
            self.use_same_dir = False
            logger.info(f"출력 폴더 선택: {dirname}")

    def get_output_path(self, input_path):
        """출력 파일 경로 생성"""
        input_path_obj = Path(input_path)
        conv_type = self.conversion_type.get()

        if self.use_same_dir or not self.output_dir.get():
            output_dir = input_path_obj.parent
        else:
            output_dir = Path(self.output_dir.get())

        base_name = input_path_obj.stem

        if conv_type == "csv_to_json":
            output_path = output_dir / f"{base_name}.json"
        elif conv_type == "csv_to_text":
            output_path = output_dir / f"{base_name}.txt"
        elif conv_type == "csv_to_xlsx":
            output_path = output_dir / f"{base_name}.xlsx"
        else:
            output_path = output_dir / f"{base_name}.csv"

        return str(output_path)

    def csv_to_json(self, input_path, output_path):
        """CSV를 JSON으로 변환"""
        try:
            encoding = self.encoding_var.get()
            delimiter = self.delimiter_var.get()
            pretty = self.pretty_print_var.get()

            data = []
            with open(input_path, 'r', encoding=encoding, newline='') as f:
                reader = csv.DictReader(f, delimiter=delimiter)
                for row in reader:
                    data.append(row)

            with open(output_path, 'w', encoding='utf-8') as f:
                if pretty:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                else:
                    json.dump(data, f, ensure_ascii=False)

            return len(data)

        except Exception as e:
            logger.error(
                f"CSV → JSON 변환 오류 ({input_path}): {e}", exc_info=True)
            raise

    def csv_to_text(self, input_path, output_path):
        """CSV를 텍스트로 변환"""
        try:
            encoding = self.encoding_var.get()

            with open(input_path, 'r', encoding=encoding, newline='') as f:
                content = f.read()

            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(content)

            return len(content.split('\n'))

        except Exception as e:
            logger.error(f"CSV → 텍스트 변환 오류 ({input_path}): {e}", exc_info=True)
            raise

    def csv_to_xlsx(self, input_path, output_path):
        """CSV를 XLSX로 변환"""
        try:
            encoding = self.encoding_var.get()
            delimiter = self.delimiter_var.get()

            logger.info(f"CSV → XLSX 변환 시작: {input_path}")

            # pandas로 CSV 읽기
            df = pd.read_csv(
                input_path,
                encoding=encoding,
                delimiter=delimiter,
                dtype=str,  # 모든 데이터를 문자열로 읽어서 원본 유지
                keep_default_na=False  # 빈 셀을 NaN이 아닌 빈 문자열로 처리
            )

            logger.info(f"총 {len(df)}개 행, {len(df.columns)}개 열 읽음")

            # Excel 파일로 저장 (통합 시트)
            with pd.ExcelWriter(
                output_path,
                engine='openpyxl'
            ) as writer:
                df.to_excel(
                    writer,
                    sheet_name='Sheet1',  # 통합 시트 이름
                    index=False,  # 인덱스 제거
                    header=True
                )

                # 열 너비 자동 조정
                worksheet = writer.sheets['Sheet1']
                for idx, col in enumerate(df.columns, 1):
                    max_length = max(
                        df[col].astype(str).str.len(
                        ).max() if len(df) > 0 else 0,
                        len(str(col))
                    )
                    # 최대 너비 제한 (50자)
                    adjusted_width = min(max_length + 2, 50)
                    # 열 인덱스를 Excel 열 문자로 변환 (A, B, C, ...)
                    col_letter = get_column_letter(idx)
                    worksheet.column_dimensions[col_letter].width = adjusted_width

            logger.info(f"XLSX 파일 저장 완료: {output_path}")
            return len(df)

        except Exception as e:
            logger.error(
                f"CSV → XLSX 변환 오류 ({input_path}): {e}", exc_info=True)
            raise

    def json_to_csv(self, input_path, output_path):
        """JSON을 CSV로 변환"""
        try:
            with open(input_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            if not data:
                raise ValueError("JSON 데이터가 비어있습니다.")

            if not isinstance(data, list):
                data = [data]

            all_keys = set()
            for item in data:
                if isinstance(item, dict):
                    all_keys.update(item.keys())
            all_keys = sorted(list(all_keys))

            with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=all_keys)
                writer.writeheader()

                for item in data:
                    if isinstance(item, dict):
                        writer.writerow(item)
                    else:
                        writer.writerow({})

            return len(data)

        except Exception as e:
            logger.error(
                f"JSON → CSV 변환 오류 ({input_path}): {e}", exc_info=True)
            raise

    def log_message(self, message):
        """로그 메시지 추가"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    def start_batch_convert(self):
        """일괄 변환 시작"""
        if self.is_converting:
            messagebox.showwarning("경고", "변환이 이미 진행 중입니다.")
            return

        if not self.input_files:
            messagebox.showwarning("경고", "변환할 파일을 추가해주세요.")
            return

        if not self.use_same_dir and not self.output_dir.get():
            messagebox.showwarning(
                "경고", "출력 폴더를 선택하거나 '원본 파일과 같은 폴더에 저장'을 체크해주세요.")
            return

        # 별도 스레드에서 실행
        thread = Thread(target=self.batch_convert, daemon=True)
        thread.start()

    def batch_convert(self):
        """일괄 변환 실행"""
        self.is_converting = True
        self.convert_btn.config(state='disabled')
        self.log_text.delete(1.0, tk.END)

        total_files = len(self.input_files)
        success_count = 0
        fail_count = 0
        conv_type = self.conversion_type.get()

        self.progress_bar['maximum'] = total_files
        self.progress_bar['value'] = 0

        self.log_message(f"=== 변환 시작 ===")
        self.log_message(f"변환 타입: {conv_type}")
        self.log_message(f"총 {total_files}개 파일 처리 시작")
        self.log_message("")

        for idx, input_path in enumerate(self.input_files, 1):
            try:
                output_path = self.get_output_path(input_path)
                file_name = os.path.basename(input_path)

                self.progress_var.set(
                    f"처리 중: {file_name} ({idx}/{total_files})")
                self.status_var.set(f"변환 중... ({idx}/{total_files})")
                self.root.update()

                logger.info(
                    f"[{idx}/{total_files}] 변환 시작: {input_path} -> {output_path}")

                if conv_type == "csv_to_json":
                    row_count = self.csv_to_json(input_path, output_path)
                    self.log_message(
                        f"✓ [{idx}/{total_files}] {file_name} -> {os.path.basename(output_path)} ({row_count}개 행)")
                elif conv_type == "csv_to_text":
                    line_count = self.csv_to_text(input_path, output_path)
                    self.log_message(
                        f"✓ [{idx}/{total_files}] {file_name} -> {os.path.basename(output_path)} ({line_count}줄)")
                elif conv_type == "csv_to_xlsx":
                    row_count = self.csv_to_xlsx(input_path, output_path)
                    self.log_message(
                        f"✓ [{idx}/{total_files}] {file_name} -> {os.path.basename(output_path)} ({row_count}개 행)")
                else:  # json_to_csv
                    item_count = self.json_to_csv(input_path, output_path)
                    self.log_message(
                        f"✓ [{idx}/{total_files}] {file_name} -> {os.path.basename(output_path)} ({item_count}개 항목)")

                success_count += 1

            except Exception as e:
                error_msg = str(e)
                self.log_message(
                    f"✗ [{idx}/{total_files}] {file_name} - 오류: {error_msg}")
                logger.error(
                    f"파일 변환 실패 ({input_path}): {error_msg}", exc_info=True)
                fail_count += 1

            self.progress_bar['value'] = idx
            self.root.update()

        # 완료 메시지
        self.log_message("")
        self.log_message(f"=== 변환 완료 ===")
        self.log_message(f"성공: {success_count}개")
        self.log_message(f"실패: {fail_count}개")

        self.progress_var.set("완료")
        self.status_var.set(f"변환 완료: 성공 {success_count}개, 실패 {fail_count}개")
        self.progress_bar['value'] = total_files

        self.is_converting = False
        self.convert_btn.config(state='normal')

        # 완료 알림
        if fail_count == 0:
            messagebox.showinfo(
                "완료", f"모든 파일 변환이 완료되었습니다.\n\n성공: {success_count}개")
        else:
            messagebox.showwarning(
                "완료", f"변환이 완료되었습니다.\n\n성공: {success_count}개\n실패: {fail_count}개")

        logger.info(f"일괄 변환 완료: 성공 {success_count}개, 실패 {fail_count}개")

    def reset(self):
        """초기화"""
        if self.is_converting:
            messagebox.showwarning("경고", "변환이 진행 중입니다. 완료 후 초기화해주세요.")
            return

        self.input_files.clear()
        self.file_listbox.delete(0, tk.END)
        self.output_dir.set("")
        self.use_same_dir = True
        self.log_text.delete(1.0, tk.END)
        self.progress_bar['value'] = 0
        self.progress_var.set("대기 중...")
        self.status_var.set("준비됨")
        logger.info("초기화 완료")
        self.log_message("초기화되었습니다.")


def main():
    """메인 함수"""
    root = tk.Tk()
    CSVJSONConverter(root)
    root.mainloop()


if __name__ == "__main__":
    main()
