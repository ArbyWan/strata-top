// Protocol-accurate stand-in for the strata engine: no GPU, no model, real line protocol.
//   READY <ctx> stop | GEN <max_new> ... <ids> | STOP | QUIT
// The prompt size it reports is the REAL one (counted from the ids the front end sends), because the
// context refuses a DONE whose prompt count disagrees with what it sent.
//
// After each request it also writes the engine's own counter lines to STDERR, exactly as the real
// engine does — that is the channel /status learns expert-hit / KV numbers from, and it is a
// different channel from the stdout protocol.
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

static void say(const std::string & s) {
    std::fwrite(s.data(), 1, s.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}
static void note(const std::string & s) {   // engine chatter: stderr, like the real engine
    std::fwrite(s.data(), 1, s.size(), stderr);
    std::fputc('\n', stderr);
    std::fflush(stderr);
}
static void nap(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

// "GEN <max_new> [key=value ...] <id,id,...>" -> the trailing comma list is the prompt
static long long prompt_len(const std::string & line) {
    const size_t sp = line.find_last_of(' ');
    if (sp == std::string::npos) return 0;
    const std::string ids = line.substr(sp + 1);
    long long n = 0;
    bool in_number = false;
    for (char c : ids) {
        if (c >= '0' && c <= '9') { if (!in_number) { ++n; in_number = true; } }
        else in_number = false;
    }
    return n;
}

int main() {
    note("strata generate: session is up (engine fake)");
    say("INFO engine=fake-friday batch_slots=1");
    say("READY 131768 stop");

    std::string line;
    int ch;
    long long served = 0;
    for (;;) {
        line.clear();
        while ((ch = std::fgetc(stdin)) != EOF && ch != '\n') line.push_back((char) ch);
        if (ch == EOF && line.empty()) break;

        if (line.rfind("GEN ", 0) == 0) {
            const long long pn = prompt_len(line);
            char buf[256];
            std::snprintf(buf, sizeof buf, "PP %lld %lld %lld.0 %lld.0", pn / 2, pn, 300 + pn / 20, 1400 + pn / 40);
            say(buf);
            nap(80);
            std::snprintf(buf, sizeof buf, "PP %lld %lld %lld.0 %lld.0", pn, pn, 900 + pn / 10, 1400 + pn / 40);
            say(buf);
            char resume[64];
            std::snprintf(resume, sizeof resume, "RESUME %lld", pn / 2);
            say(resume);
            for (int i = 0; i < 40; ++i) {
                say("T 100");
                nap(60);
            }
            std::snprintf(buf, sizeof buf, "DONE 40 %lld %lld.0 2400.0 stop 30 42 %lld", pn, 900 + pn / 10, pn / 2);
            say(buf);

            // the counters the real engine writes between requests — stderr, not protocol
            ++served;
            std::snprintf(buf, sizeof buf,
                "strata serve: decode expert cache hit rate: 79.5%% (%lld hits / %lld lookups); "
                "7188 more read by the GPU over PCIe or from another GPU (4.3%% of all %lld routed)",
                127799LL * served, 160662LL * served, 167850LL * served);
            note(buf);
            std::snprintf(buf, sizeof buf,
                "strata serve: KV streaming: 98.39%% of %lld block reads hit VRAM, %.1f MiB read from RAM",
                100674960LL * served, 6536.3 * served);
            note(buf);
            std::snprintf(buf, sizeof buf,
                "strata serve: route tail skip: %lld missed experts skipped (%lld entries) since the start",
                1157073LL * served, 1209049LL * served);
            note(buf);
        } else if (line.rfind("STOP", 0) == 0) {
            say("DONE 0 0 0.0 0.0 cancel 0 0 0");
        } else if (line.rfind("QUIT", 0) == 0) {
            break;
        }
    }
    return 0;
}
