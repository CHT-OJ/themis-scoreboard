# Themis Scoreboard

Website Flask nhe de upload file Excel Themis va hien thi bang diem lap trinh.

## Chay local

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Mo `http://127.0.0.1:5000`.

Trang admin: `http://127.0.0.1:5000/admin`

Mat khau mac dinh trong `.env.example`: `admin123`

Neu mang PyPI cham tren Windows, thu:

```powershell
python -m pip install --default-timeout 120 --retries 10 -r requirements.txt
```

Hoac tao venv dung package he thong da co san:

```powershell
deactivate
Remove-Item -Recurse -Force .venv
python -m venv .venv --system-site-packages
.\.venv\Scripts\Activate.ps1
python app.py
```

## Cau truc Excel

Moi file can co 2 sheet:

- `Tổng hợp điểm`: gom `Mã thí sinh`, cac cot bai thi, `Tổng điểm`.
- `Chi tiết chấm`: gom `Mã thí sinh`, `Bài thi`, `Test`, `Điểm`, `Ghi chú`.

Admin chi can upload 1 file Excel nhu `KQUA.xlsx` la he thong tu phan tich va cong bo scoreboard. Neu co nhieu phong thi, co the chon nhieu file cung luc; moi file se duoc gan thanh mot phong. Neu parse loi, snapshot diem cu van duoc giu lai.
