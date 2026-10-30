// Standalone research adapter for an externally supplied KeyMagic engine.
// The engine is not bundled here; it is distributed under GPL-2.0 by its
// upstream project. This program models printable US-keyboard input and a
// simple host passthrough for keys the engine does not consume. It is not a
// replacement for a platform input method and is not a PDF decoder.
//
// On Linux, build against libkeymagic at the revision in draft-layouts.json:
// D=/path/to/keymagic/cross-platform/libkeymagic
// g++ -std=c++11 -O2 -D_fdopen=fdopen -I"$D" font-layout-probe.cpp \
//   "$D"/{KeyMagicEngine,KeyMagicString,KeyMagicKeyboard,KeyCodes,KeyMagicLogger,KeyMagicTypes,LogFileWriter,KeyMagicErrorLogger,RuleInfo,Util}.cpp \
//   -o /tmp/font-layout-probe
//
// Usage: font-layout-probe COMPILED_KEYBOARD < INPUT_SEQUENCES
// One printable ASCII key sequence per line; uppercase and shifted punctuation
// denote Shift. Output is input bytes in hex, TAB, final code points in hex
// separated by commas. Context is reset between lines, not between keys.

#include <iomanip>
#include <iostream>
#include <string>

#include "keymagic.h"

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "usage: font-layout-probe COMPILED_KEYBOARD\n";
        return 2;
    }

    libkm::KeyMagicEngine engine;
    if (!engine.loadKeyboardFile(argv[1])) {
        std::cerr << "could not load the compiled keyboard\n";
        return 3;
    }

    std::string keys;
    while (std::getline(std::cin, keys)) {
        engine.reset();
        for (unsigned char key : keys) {
            if (key < 0x20 || key > 0x7e) {
                std::cerr << "input must contain only printable ASCII keys\n";
                return 4;
            }

            int keycode = 0;
            int modifier = 0;
            if (key == ' ') {
                keycode = 0x20;
            } else if (!libkm::GetKeyCodeAndModifier(key, &keycode, &modifier)) {
                std::cerr << "could not resolve US key position\n";
                return 5;
            }

            const unsigned char shift =
                (modifier & libkm::KeyMagicEngine::SHIFT_MASK) ? 0x80 : 0;
            engine.setKeyState(libkm::VK_SHIFT, shift);
            engine.setKeyState(libkm::VK_LSHIFT, shift);
            if (!engine.processKeyEvent(key, keycode, modifier)) {
                // Model the host inserting the original character when the
                // engine does not handle the key. Host behavior can differ.
                libkm::KeyMagicString text = engine.getContextText();
                text.push_back(static_cast<wchar_t>(key));
                engine.setContextText(text);
            }
        }

        for (unsigned char key : keys) {
            std::cout << std::hex << std::setw(2) << std::setfill('0')
                      << static_cast<unsigned>(key);
        }
        std::cout << '\t';
        bool first = true;
        for (wchar_t codepoint : engine.getContextText()) {
            if (!first) std::cout << ',';
            std::cout << std::hex << static_cast<unsigned>(codepoint);
            first = false;
        }
        std::cout << '\n';
    }
}
