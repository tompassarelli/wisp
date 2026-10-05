/* C is the irreducible boundary to StormLib's MPQ archive API. */
#include <stdio.h>
#include <string.h>
#include <StormLib.h>

int main(int argc, char **argv) {
    if ((argc != 4 && argc != 5) || (strcmp(argv[1], "extract") && strcmp(argv[1], "replace"))) {
        fprintf(stderr, "Usage: map-pack extract|replace MAP.w3x FILE [ARCHIVE_NAME]\n");
        return 2;
    }
    const char * archiveName = argc == 5 ? argv[4] : "war3map.lua";
    HANDLE archive;
    if (!SFileOpenArchive(argv[2], 0, 0, &archive)) {
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
