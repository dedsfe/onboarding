#!/usr/bin/env python3
"""Render the introduction's original, optional felt-bell motif. No samples or dependencies."""

import argparse
import array
import math
from pathlib import Path
import sys
import wave


def render(destination: Path) -> None:
    rate = 32000
    duration = 10.5
    channels = [array.array("d", [0.0]) * int(rate * duration) for _ in range(2)]
    # Three phrases follow the painting, the separation and the final composition.
    notes = [(0.10, 62, 0.70, -0.25), (0.72, 69, 0.32, 0.28),
             (1.52, 76, 0.22, 0.12), (2.90, 67, 0.38, -0.18),
             (3.72, 74, 0.28, 0.25), (5.60, 69, 0.35, -0.12),
             (6.35, 76, 0.20, 0.28), (8.05, 62, 0.38, -0.20),
             (8.05, 66, 0.17, 0.05), (8.05, 69, 0.15, 0.20)]
    for start, midi, strength, pan in notes:
        frequency = 440 * 2 ** ((midi - 69) / 12)
        left, right = math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)
        first = int(start * rate)
        length = min(int(4.3 * rate), len(channels[0]) - first)
        for frame in range(length):
            t = frame / rate
            attack = 1 - math.exp(-t * 95)
            fundamental = math.sin(2 * math.pi * frequency * t) * math.exp(-t * 1.25)
            second = 0.19 * math.sin(2 * math.pi * frequency * 2.002 * t) * math.exp(-t * 2.7)
            third = 0.055 * math.sin(2 * math.pi * frequency * 3.006 * t) * math.exp(-t * 4.8)
            value = strength * attack * (fundamental + second + third)
            position = first + frame
            channels[0][position] += value * left
            channels[1][position] += value * right
            for delay, gain in [(0.073, 0.12), (0.149, 0.07), (0.263, 0.04)]:
                reflected = position + int(delay * rate)
                if reflected < len(channels[0]):
                    channels[0][reflected] += value * right * gain
                    channels[1][reflected] += value * left * gain
    peak = max(max(abs(x) for x in channel) for channel in channels)
    samples = array.array("h")
    for frame in range(len(channels[0])):
        fade = min(1, (len(channels[0]) - frame) / (rate * 0.7))
        for channel in channels:
            samples.append(round(channel[frame] / max(peak, 1) * fade * 0.35 * 32767))
    if sys.byteorder != "little":
        samples.byteswap()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(samples.tobytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]
                        / "Sources/BulkMaker/Resources/Introduction/intro-score.wav")
    render(parser.parse_args().output)
