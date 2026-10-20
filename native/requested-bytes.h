// Lua32 counts the bytes a program asks for, hits on interned strings included and table resizes at their net growth, and leaves out the string table, stacks and call frames the collector resizes, and everything a running hook allocates, so the count is independent of layout, collection timing and profiling.
#define LUA_GCREQUESTED 12
#define wisp_charge(L, bytes) ((L)->allowhook ? (void)(G(L)->requested += (bytes)) : (void)0)
#define wisp_credit(L, bytes) ((L)->allowhook ? (void)(G(L)->requested -= (bytes)) : (void)0)
#define wisp_uncharged(L, call) do { size_t wisp_before = G(L)->requested; call; G(L)->requested = wisp_before; } while (0)
