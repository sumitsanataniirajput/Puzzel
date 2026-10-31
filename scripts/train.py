"""Minimal from-scratch language-model training script.

Trains a small GPT-style model with HuggingFace `transformers` from scratch,
using the device auto-detected by scripts/detect_cuda.py (CUDA if available,
CPU otherwise). Progress is shown with tqdm and a loss curve is plotted with
matplotlib. Training metadata is saved to the SQLite database via scripts/db.py.

Usage:
    python scripts/train.py \
        --tokenizer models/configs/tokenizer.json \
        --data data/processed/train.txt \
        --epochs 3 \
        --batch-size 4 \
        --lr 5e-4
"""

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm
from transformers import AutoConfig, AutoModelForCausalLM
from transformers import PreTrainedTokenizerFast

BASE_DIR = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(BASE_DIR / "scripts"))
from db import log_run  # noqa: E402  (scripts/db.py)


class TextDataset(torch.utils.data.Dataset):
    """Simple character-window dataset over a tokenized text file."""

    def __init__(self, token_ids: list[int], block_size: int = 128):
        self.token_ids = token_ids
        self.block_size = block_size

    def __len__(self):
        return max(0, len(self.token_ids) - self.block_size)

    def __getitem__(self, idx):
        chunk = self.token_ids[idx : idx + self.block_size + 1]
        return {
            "input_ids": torch.tensor(chunk[:-1], dtype=torch.long),
            "labels": torch.tensor(chunk[1:], dtype=torch.long),
        }


def load_text_ids(path: Path, tokenizer) -> list[int]:
    text = path.read_text(encoding="utf-8")
    encoded = tokenizer.encode(text)
    return encoded.ids if hasattr(encoded, "ids") else encoded


def train(args) -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # --- Tokenizer ------------------------------------------------------
    tokenizer = PreTrainedTokenizerFast(tokenizer_file=str(BASE_DIR / args.tokenizer))
    tokenizer.pad_token = "[PAD]"
    vocab_size = tokenizer.vocab_size
    print(f"Vocab size: {vocab_size}")

    # --- Data -----------------------------------------------------------
    train_ids = load_text_ids(BASE_DIR / args.data, tokenizer)
    print(f"Training tokens: {len(train_ids):,}")
    dataset = TextDataset(train_ids, block_size=args.block_size)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)

    # --- Model (from scratch) ------------------------------------------
    config = AutoConfig.for_model(
        "gpt2",
        vocab_size=vocab_size,
        n_positions=args.block_size,
        n_ctx=args.block_size,
        n_embd=args.embedding_dim,
        n_layer=args.num_layers,
        n_head=args.num_heads,
    )
    model = AutoModelForCausalLM.from_config(config)
    model.to(device)
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # --- Optimizer ------------------------------------------------------
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)

    # --- Training loop --------------------------------------------------
    model.train()
    losses = []
    run_id = log_run(
        device=str(device),
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        vocab_size=vocab_size,
        notes=args.notes,
    )

    global_step = 0
    for epoch in range(1, args.epochs + 1):
        epoch_loss = 0.0
        pbar = tqdm(loader, desc=f"Epoch {epoch}/{args.epochs}", unit="batch")
        for batch in pbar:
            input_ids = batch["input_ids"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, labels=labels)
            loss = outputs.loss

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()
            global_step += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")

            if global_step % args.log_every == 0:
                losses.append((global_step, loss.item()))

        avg_loss = epoch_loss / max(1, len(loader))
        print(f"Epoch {epoch} average loss: {avg_loss:.4f}")

    # --- Checkpoint -----------------------------------------------------
    ckpt_dir = BASE_DIR / "models" / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    ckpt_path = ckpt_dir / f"lm_{timestamp}.pt"
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "config": config.to_dict(),
            "tokenizer": str(args.tokenizer),
        },
        ckpt_path,
    )
    print(f"Checkpoint saved: {ckpt_path}")

    # --- Plot loss curve ------------------------------------------------
    plot_losses(losses, BASE_DIR / "models" / "configs" / "loss_curve.png")

    # --- Database record ------------------------------------------------
    final_loss = losses[-1][1] if losses else None
    with open(BASE_DIR / "models" / "configs" / "last_run.json", "w") as f:
        json.dump(
            {
                "run_id": run_id,
                "device": str(device),
                "epochs": args.epochs,
                "batch_size": args.batch_size,
                "lr": args.lr,
                "vocab_size": vocab_size,
                "final_loss": final_loss,
                "checkpoint": str(ckpt_path),
            },
            f,
            indent=2,
        )
    print(f"Run logged to database (run id {run_id}), final loss: {final_loss}")


def plot_losses(losses, out_path: Path) -> None:
    if not losses:
        return
    steps, vals = zip(*losses)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.figure(figsize=(8, 4))
    plt.plot(steps, vals, marker="o")
    plt.xlabel("Step")
    plt.ylabel("Loss")
    plt.title("Training loss")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    print(f"Loss curve saved: {out_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train a small LM from scratch")
    parser.add_argument("--tokenizer", default="models/configs/tokenizer.json", help="Tokenizer file")
    parser.add_argument("--data", default="data/processed/train.txt", help="Training text file")
    parser.add_argument("--epochs", type=int, default=3, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--lr", type=float, default=5e-4, help="Learning rate")
    parser.add_argument("--block-size", type=int, default=128, help="Context window")
    parser.add_argument("--embedding-dim", type=int, default=256, help="Model embedding dim")
    parser.add_argument("--num-layers", type=int, default=4, help="Number of transformer layers")
    parser.add_argument("--num-heads", type=int, default=4, help="Number of attention heads")
    parser.add_argument("--log-every", type=int, default=50, help="Log every N steps")
    parser.add_argument("--notes", default="", help="Free-text notes for the run record")
    return parser


if __name__ == "__main__":
    args = build_parser().parse_args()
    train(args)
