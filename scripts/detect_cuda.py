"""Verify CUDA detection for PyTorch.

Run:
    python scripts/detect_cuda.py

This script checks whether PyTorch can see a CUDA-capable GPU (e.g. the GPU on
your phone/PC). If no GPU is present in this environment it falls back to CPU
and prints instructions for enabling CUDA on a machine with an NVIDIA GPU.
"""

import torch


def detect_cuda() -> torch.device:
    """Detect and return the best available device, printing a full report."""
    print("=" * 60)
    print("CUDA / PyTorch detection report")
    print("=" * 60)
    print(f"PyTorch version : {torch.__version__}")
    print(f"CUDA available  : {torch.cuda.is_available()}")

    if torch.cuda.is_available():
        print(f"CUDA version    : {torch.version.cuda}")
        print(f"GPU count       : {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            print(f"  GPU {i}         : {props.name}")
            print(f"    compute cap.: {props.major}.{props.minor}")
            print(f"    total VRAM  : {props.total_memory / 1024**3:.2f} GiB")
        device = torch.device("cuda")
        # Sanity check: allocate a small tensor on the GPU
        x = torch.randn(4, 4, device=device)
        print(f"GPU tensor test : OK (device={x.device})")
        print("\n>>> CUDA is active — training will run on the GPU.")
    else:
        device = torch.device("cpu")
        print("GPU count       : 0")
        print("\n>>> No CUDA device detected in this environment.")
        print("    Falling back to CPU. To train on your phone/PC GPU:")
        print("    1. Install NVIDIA drivers + CUDA toolkit on that machine.")
        print("    2. Reinstall torch with CUDA support:")
        print("       pip install --index-url https://download.pytorch.org/whl/cu121 torch")
        print("    3. Re-run this script — torch.cuda.is_available() should be True.")

    print("=" * 60)
    return device


if __name__ == "__main__":
    detect_cuda()
