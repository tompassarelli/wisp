/* C is the irreducible boundary to StormLib's MPQ archive API. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <StormLib.h>

/* Doubles the archive's file capacity. StormLib reports a full file table
 * as ENOSPC; the raw hash table it returns is the one last written, so
 * entries added since this opening can't be counted there. On a disk that
 * is really full the retried add fails the same way. */
static bool growArchive(HANDLE archive) {
    DWORD count;
    if (!SFileGetFileInfo(archive, SFileMpqMaxFileCount, &count, sizeof(count), NULL)) return false;
    if (count == 0 || count >= HASH_TABLE_SIZE_MAX) return false;
    return SFileSetMaxFileCount(archive, count * 2);
}

static bool addEntry(HANDLE archive, const char *file, const char *archiveName) {
    bool ok = SFileAddFileEx(archive, file, archiveName,
                             MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING,
                             MPQ_COMPRESSION_ZLIB, MPQ_COMPRESSION_ZLIB);
    if (!ok && GetLastError() == ERROR_DISK_FULL) {
        DWORD error = GetLastError();
        if (growArchive(archive)) {
            ok = SFileAddFileEx(archive, file, archiveName,
                                MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING,
                                MPQ_COMPRESSION_ZLIB, MPQ_COMPRESSION_ZLIB);
        } else {
            SetLastError(error);
        }
    }
    return ok;
}

static int eachListed(HANDLE archive, const char *list, bool replace) {
    FILE *lines = fopen(list, "r");
    if (lines == NULL) {
        fprintf(stderr, "Cannot open entry list %s\n", list);
        return 1;
    }
    char *line = NULL;
    size_t capacity = 0;
    ssize_t length;
    unsigned number = 0;
    int status = 0;
    while (status == 0 && (length = getline(&line, &capacity, lines)) != -1) {
        number++;
        if (length > 0 && line[length - 1] == '\n') line[--length] = '\0';
        if (length == 0) continue;
        char *tab = strchr(line, '\t');
        if (tab == NULL || tab == line || tab[1] == '\0' || strchr(tab + 1, '\t') != NULL) {
            fprintf(stderr, "Entry list line %u is not FILE<TAB>ARCHIVE_NAME\n", number);
            status = 2;
            break;
        }
        *tab = '\0';
        bool ok = replace ? addEntry(archive, line, tab + 1) : SFileExtractFile(archive, tab + 1, line, SFILE_OPEN_FROM_MPQ);
        if (!ok) {
            fprintf(stderr, "Cannot %s %s (%u)\n", replace ? "replace" : "extract", tab + 1, GetLastError());
            status = 1;
        }
    }
    free(line);
    fclose(lines);
    return status;
}

int main(int argc, char **argv) {
    const char *command = argc > 1 ? argv[1] : "";
    bool listed = !strcmp(command, "replace-list") || !strcmp(command, "extract-list");
    bool single = !strcmp(command, "extract") || !strcmp(command, "replace");
    if (!(listed && argc == 4) && !(single && (argc == 4 || argc == 5))) {
        fprintf(stderr, "Usage: map-pack extract|replace MAP.w3x FILE [ARCHIVE_NAME]\n"
                        "       map-pack extract-list|replace-list MAP.w3x LIST (lines FILE<TAB>ARCHIVE_NAME)\n");
        return 2;
    }
    bool replace = !strcmp(command, "replace") || !strcmp(command, "replace-list");
    HANDLE archive;
    /* Extraction opens read-only: inputs may be sealed, and are never changed. */
    if (!SFileOpenArchive(argv[2], 0, replace ? 0 : MPQ_OPEN_READ_ONLY, &archive)) {
        fprintf(stderr, "Cannot open map archive (%u)\n", GetLastError());
        return 1;
    }
    int status;
    if (listed) {
        status = eachListed(archive, argv[3], replace);
    } else {
        const char *archiveName = argc == 5 ? argv[4] : "war3map.lua";
        bool ok = replace ? addEntry(archive, argv[3], archiveName) : SFileExtractFile(archive, archiveName, argv[3], SFILE_OPEN_FROM_MPQ);
        if (!ok) fprintf(stderr, "Cannot %s map script (%u)\n", command, GetLastError());
        status = ok ? 0 : 1;
    }
    if (!SFileCloseArchive(archive)) {
        fprintf(stderr, "Cannot close map archive (%u)\n", GetLastError());
        return 1;
    }
    return status;
}
