"""Engine workspace paths; directory creation is explicit, not import-time."""
from pathlib import Path
from .secure_data.secure import ENGINE_ROOT, DATA_DIR, MASTER_ENC
from .MonoSyllabism.utilities.buffer import resolve_path, resolve_inputs

BASE_DIR = ENGINE_ROOT.parents[2] / 'Junk'
DEFAULT_DIRS = ('PDFs', 'docx', 'input', 'upload/input', 'output/txt',
                'output/docx', 'output/pdf', 'log/logfromengine', 'File/input')
_workspace = {'INPUT_DIR': BASE_DIR / 'input', 'UPLOAD_DIR': BASE_DIR / 'upload',
              'OUTPUT_DIR': BASE_DIR / 'output', 'LOG_DIR': BASE_DIR / 'log/logfromengine'}


def ensure_dirs():
    for directory in DEFAULT_DIRS: (BASE_DIR / directory).mkdir(parents=True, exist_ok=True)
    return dict(_workspace)


def configure_workspace(*, log_dir=None, output_dir=None):
    if log_dir is not None: _workspace['LOG_DIR'] = Path(log_dir).resolve()
    if output_dir is not None: _workspace['OUTPUT_DIR'] = Path(output_dir).resolve()


def ensure_workspace():
    for key in ('OUTPUT_DIR', 'LOG_DIR'): _workspace[key].mkdir(parents=True, exist_ok=True)


def input_file(): return _workspace['INPUT_DIR'] / 'input.txt'
def output_dir(): return _workspace['OUTPUT_DIR']
def log_dir(): return _workspace['LOG_DIR']
def pdf_dir(): return BASE_DIR / 'PDFs'
def docx_dir(): return BASE_DIR / 'docx'
def data_dir(): return ENGINE_ROOT / 'knowledge/isTreasure'
def master_file(): return DATA_DIR / 'master.json'
def map_dir(): return ENGINE_ROOT / 'MonoSyllabism/map'
