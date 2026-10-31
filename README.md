# Puzzel — Language Model Training Setup

Python environment for training a language model from scratch.

## What is installed

| Package | Purpose |
|---------|---------|
| `torch` | PyTorch with CUDA support (`torch 2.15.0+cu132`) |
| `transformers` | HuggingFace model architectures / training utilities |
| `tokenizers` | Fast tokenizer training (BPE, WordPiece, …) |
| `numpy` | Numerical computing |
| `matplotlib` | Loss-curve plotting |
| `tqdm` | Progress bars |
| `sqlalchemy` | Database layer (file-based SQLite, no server needed) |

## Project structure

```
Puzzel/
├── data/                 # training data
│   ├── raw/              # raw corpora
│   └── processed/        # tokenized / cleaned text
├── models/               # model artifacts
│   ├── configs/          # tokenizer + model configs
│   └── checkpoints/      # saved model checkpoints
├── scripts/              # training scripts
│   ├── detect_cuda.py    # CUDA verification
│   ├── train_tokenizer.py  # train a BPE tokenizer
│   ├── train.py          # train a small LM from scratch
│   └── db.py             # SQLite run-metadata database
├── configs/              # experiment configs
├── notebooks/            # exploration notebooks
├── tests/                # tests
├── .venv/                # Python virtual environment
├── requirements.txt      # pip dependencies
└── README.md
```

## Quick start

1. **Activate the environment**
   ```bash
   source .venv/bin/activate
   ```

2. **Verify CUDA detection** (use this to confirm your phone/PC GPU is seen)
   ```bash
   python scripts/detect_cuda.py
   ```
   Everything in `scripts/train.py` automatically picks `cuda` when a GPU is
   available and falls back to `cpu` otherwise — no changes needed on your side.

3. **Prepare data**
   Put a text file in `data/raw/` (one document per line), then train a tokenizer:
   ```bash
   python scripts/train_tokenizer.py --input data/raw/sample.txt \
       --output models/configs/tokenizer.json --vocab-size 30000
   ```

4. **Train**
   ```bash
   python scripts/train.py --data data/processed/train.txt --epochs 3
   ```
   Checkpoints go to `models/checkpoints/`, the loss plot to
   `models/configs/loss_curve.png`, and run metadata to `models/training.db`.

## Installing into a fresh environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Note: this sandbox has no NVIDIA GPU, so `torch.cuda.is_available()` reports
`False` here. On a machine with an NVIDIA GPU (your phone/PC with CUDA
drivers installed), the same code will detect CUDA automatically and train on
the GPU. If you need to force a CUDA wheel reinstall:

```bash
pip install --index-url https://download.pytorch.org/whl/cu121 torch
```

## License

Private project — no license.
