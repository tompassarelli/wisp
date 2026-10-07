/* C exercises the irreducible StormLib archive boundary with synthetic files. */
#define main mapPackMain
#include "map-pack.c"
#undef main
#include <assert.h>

int main(int argc, char **argv) {
    assert(argc == 3);
    HANDLE archive;
    assert(SFileCreateArchive(argv[1], 0, 4, &archive));
    char name[64];
    unsigned added = 0;
    while (added < 16) {
        snprintf(name, sizeof(name), "existing-%u.txt", added);
        if (!SFileAddFileEx(archive, argv[2], name, 0, 0, 0)) break;
        added++;
    }
    assert(added > 0 && added < 16);
    assert(GetLastError() == ERROR_DISK_FULL);
    assert(SFileCloseArchive(archive));
    char *replace[] = {"map-pack", "replace", argv[1], argv[2], "new.txt"};
    assert(mapPackMain(5, replace) == 0);
    assert(SFileOpenArchive(argv[1], 0, MPQ_OPEN_READ_ONLY, &archive));
    for (unsigned i = 0; i <= added; i++) {
        if (i == added) strcpy(name, "new.txt");
        else snprintf(name, sizeof(name), "existing-%u.txt", i);
        HANDLE file;
        char contents[32] = {0};
        DWORD read;
        assert(SFileOpenFileEx(archive, name, SFILE_OPEN_FROM_MPQ, &file));
        assert(SFileReadFile(file, contents, strlen("synthetic archive contents"), &read, NULL));
        assert(strcmp(contents, "synthetic archive contents") == 0);
        assert(SFileCloseFile(file));
    }
    assert(SFileCloseArchive(archive));
    printf("full archive: error %u before repair; new entry and %u existing entries preserved\n", ERROR_DISK_FULL, added);
    return 0;
}
