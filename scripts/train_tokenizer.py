"""Train a byte-level BPE tokenizer from raw text and save it to models/configs/.

Usage:
    python scripts/train_tokenizer.py \
        --input data/raw/sample.txt \
        --output models/configs/tokenizer.json \
        --vocab-size 30000

Requires a text file with one document per line in data/raw/.
"""

import argparse
import sys
from pathlib import Path

from tokenizers import Tokenizer
from tokenizers.models import BPE
from tokenizers.pre_tokenizers import ByteLevel
from tokenizers.trainers import BpeTrainer
from tokenizers.decoders import ByteLevel as ByteLevelDecoder

BASE_DIR = Path(__file__).resolve().parents[1]


def train_tokenizer(input_path: Path, output_path: Path, vocab_size: int) -> None:
    if not input_path.exists():
        sys.exit(f"Input file not found: {input_path}")

    # Read training text
    texts = [line.rstrip("\n") for line in input_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not texts:
        sys.exit("No text found in input file.")

    # Byte-level BPE tokenizer (works out of the box on any language)
    tokenizer = Tokenizer(BPE(unk_token="[UNK]"))
    tokenizer.pre_tokenizer = ByteLevel()
    tokenizer.decoder = ByteLevelDecoder()

    trainer = BpeTrainer(
        vocab_size=vocab_size,
        special_tokens=["[UNK]", "[CLS]", "[SEP]", "[PAD]", "[MASK]"],
        show_progress=True,
    )

    tokenizer.train_from_iterator(texts, trainer=trainer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tokenizer.save(str(output_path), pretty=True)
    print(f"Tokenizer saved to {output_path} (vocab size ~{vocab_size})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a BPE tokenizer")
    parser.add_argument("--input", required=True, help="Path to raw text file")
    parser.add_argument("--output", default="models/configs/tokenizer.json", help="Output tokenizer path")
    parser.add_argument("--vocab-size", type=int, default=30000, help="Target vocabulary size")
    args = parser.parse_args()

    train_tokenizer(BASE_DIR / args.input, BASE_DIR / args.output, args.vocab_size)


if __name__ == "__main__":
    main()
