// Lua 5.3 seeds string hashes with time and addresses, places keys and API-cached strings by address, so a run's allocation varies unless all three are fixed.
#if defined(__linux__)
#include <sys/personality.h>
#include <unistd.h>
#endif

#define WISP_HASH_SEED 0u
#define STRCACHE_N 1
#define STRCACHE_M 1

static inline void wisp_fixed_addresses(char **argv) {
#if defined(__linux__)
  int persona = personality(0xffffffff);
  if (persona == -1 || (persona & ADDR_NO_RANDOMIZE) != 0) return;
  if (personality((unsigned long)persona | ADDR_NO_RANDOMIZE) == -1) return;
  execv("/proc/self/exe", argv);
#else
  (void)argv;
#endif
}
