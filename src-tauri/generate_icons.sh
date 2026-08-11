#!/bin/bash
# Génère des icônes minimales pour Tauri
# Usage: bash generate_icons.sh

echo "Création des icônes Tauri..."

# Crée un PNG 32x32 minimal (en utilisant Python)
python3 -c "
import struct, zlib

def create_png(width, height, filename):
    # Signature PNG
    sig = b'\\x89PNG\\r\\n\\x1a\\n'

    # IHDR chunk (color type 6 = RGBA)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc & 0xffffffff)

    # IDAT chunk - blue-ish RGBA data
    raw_data = b''
    for y in range(height):
        raw_data += b'\\x00'  # filter byte
        for x in range(width):
            raw_data += b'\\x3b\\x82\\xf6\\xff'  # RGBA blue-ish color
    compressed = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed)
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc & 0xffffffff)

    # IEND chunk
    iend_crc = zlib.crc32(b'IEND')
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc & 0xffffffff)

    with open(filename, 'wb') as f:
        f.write(sig + ihdr + idat + iend)
    print(f'Created {filename} ({width}x{height})')

create_png(32, 32, 'icons/32x32.png')
create_png(128, 128, 'icons/128x128.png')
create_png(256, 256, 'icons/128x128@2x.png')
create_png(512, 512, 'icons/icon.png')
print('Done!')
"
