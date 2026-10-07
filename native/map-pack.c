/* C is the irreducible boundary to StormLib's MPQ archive API. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <StormLib.h>

static bool growFullArchive(HANDLE archive) {
    DWORD count;
    if (!SFileGetFileInfo(archive, SFileMpqHashTableSize, &count, sizeof(count), NULL)) return false;
    if (count == 0 || count >= HASH_TABLE_SIZE_MAX) return false;
    TMPQHash *table = malloc(count * sizeof(*table));
    if (table == NULL) return false;
    bool full = SFileGetFileInfo(archive, SFileMpqHashTable, table, count * sizeof(*table), NULL);
    for (DWORD i = 0; full && i < count; i++) {
        if (table[i].dwBlockIndex == HASH_ENTRY_FREE || table[i].dwBlockIndex == HASH_ENTRY_DELETED) full = false;
    }
    free(table);
    return full && SFileSetMaxFileCount(archive, count * 2);
}

int main(int argc, char **argv) {
    if ((argc != 4 && argc != 5) || (strcmp(argv[1], "extract") && strcmp(argv[1], "replace"))) {
        fprintf(stderr, "Usage: map-pack extract|replace MAP.w3x FILE [ARCHIVE_NAME]\n");
        return 2;
    }
    const char * archiveName = argc == 5 ? argv[4] : "war3map.lua";
    HANDLE archive;
    /* Extraction opens read-only: inputs may be sealed, and are never changed. */
    if (!SFileOpenArchive(argv[2], 0, strcmp(argv[1], "extract") ? 0 : MPQ_OPEN_READ_ONLY, &archive)) {
        fprintf(stderr, "Cannot open map archive (%u)\n", GetLastError());
        return 1;
    }
    bool ok;
    if (!strcmp(argv[1], "extract")) {
        ok = SFileExtractFile(archive, archiveName, argv[3], SFILE_OPEN_FROM_MPQ);
    } else {
        ok = SFileAddFileEx(archive, argv[3], archiveName,
                            MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING,
                            MPQ_COMPRESSION_ZLIB, MPQ_COMPRESSION_ZLIB);
        /* ENOSPC also describes a full MPQ hash table, not just a full disk.
         * Resize only that case; existing entries and extraction need no growth. */
        if (!ok && GetLastError() == ERROR_DISK_FULL) {
            DWORD error = GetLastError();
            if (growFullArchive(archive)) {
                ok = SFileAddFileEx(archive, argv[3], archiveName,
                                   MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING,
                                   MPQ_COMPRESSION_ZLIB, MPQ_COMPRESSION_ZLIB);
            } else {
                SetLastError(error);
            }
        }
    }
    if (!ok) {
        fprintf(stderr, "Cannot %s map script (%u)\n", argv[1], GetLastError());
        SFileCloseArchive(archive);
        return 1;
    }
    if (!SFileCloseArchive(archive)) {
        fprintf(stderr, "Cannot close map archive (%u)\n", GetLastError());
        return 1;
    }
    return 0;
}
