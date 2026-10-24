/**
 * What a scoped search says it searched, tested where it can be.
 *
 * A scope resolves against the CATALOGUE, which ships complete before anything
 * is downloaded. On a full install every scoped book is on the disk, so the
 * live tests cannot tell «books the scope named» from «books the engine read».
 * The synthetic library can: SYN.CATALOGUED_ONLY is a Hanafi book in the
 * catalogue with no file behind it, and there is no other Hanafi book. The
 * three madhhab categories hold four catalogued books, three of them on disk.
 *
 * The engine is stubbed — what is under test is the counting, not the search.
 */

import * as path from "node:path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { Catalog } from "../../src/server/catalog.js";
import type { Helper } from "../../src/server/helper.js";
import type { PageStore } from "../../src/server/pages.js";
import { runScanConsensus, scanConsensusInput } from "../../src/server/tools/scanConsensus.js";
import { runSearchPages, searchPagesInput } from "../../src/server/tools/searchPages.js";
import { runVerifyQuote, verifyQuoteInput } from "../../src/server/tools/verifyQuote.js";
import { SYN_CATEGORY, createSyntheticLibrary, type SyntheticLibrary } from "../fixtures/synthetic-library.js";
import { getDb } from "../fixtures/shared.js";

let lib: SyntheticLibrary;
let catalog: Catalog;

beforeAll(async () => {
    lib = await createSyntheticLibrary();
    catalog = await Catalog.load(path.join(lib.database, "master.db"), getDb(), {
        databaseRoot: lib.database,
    });
}, 60_000);

afterAll(() => lib?.cleanup());

/** An engine that finds nothing anywhere, whichever command it is sent. */
const emptyHelper = {
    request: async (_cmd: string, args: Record<string, unknown>) => ({
        query: String(args.query ?? ""),
        normalized_tokens: [],
        offset: 0,
        total_hits: 0,
        returned: 0,
        has_more: false,
        scope_count: -1,
        results: [],
        group_totals: [0, 0],
        coverage: { by_book_key: {}, total_seen: 0, at_cap: false, basis: "all_results" },
    }),
} as unknown as Helper;

// Nothing is found, so no page is ever read and no PageStore is needed.
const noPages = {} as PageStore;

const HANAFI = { category_ids: [SYN_CATEGORY.HANAFI] };
const THREE_SCHOOLS = { category_ids: [SYN_CATEGORY.HANAFI, SYN_CATEGORY.SHAFII, SYN_CATEGORY.HANBALI] };

const scan = (scope: Record<string, unknown>) =>
    runScanConsensus(
        emptyHelper,
        catalog,
        noPages,
        scanConsensusInput.parse({
            response_format: "json",
            question: "الاستصناع",
            formulas: ["بالإجماع"],
            witnesses: 0,
            scope,
        }),
    ).then((r) => r.structuredContent.searched);

const search = (scope: Record<string, unknown>) =>
    runSearchPages(
        emptyHelper,
        catalog,
        noPages,
        searchPagesInput.parse({ response_format: "json", query: "الاستصناع", scope }),
    ).then((r) => r.structuredContent);

const verify = (scope: Record<string, unknown>) =>
    runVerifyQuote(
        emptyHelper,
        catalog,
        noPages,
        verifyQuoteInput.parse({ response_format: "json", quote: "يجوز الاستصناع في كل ما جرى فيه التعامل", scope }),
    ).then((r) => r.structuredContent.searched);

describe("a scope names catalogue books, not books on the disk", () => {
    describe("shamela_scan_consensus", () => {
        it("does not count a scoped book the disk lacks as searched", async () => {
            const searched = await scan(HANAFI);
            expect(searched.scoped).toBe(true);
            expect(searched.books).toBe(0);
        });

        it("counts only the scoped books that are downloaded", async () => {
            expect((await scan(THREE_SCHOOLS)).books).toBe(3);
        });
    });

    describe("shamela_search_pages", () => {
        it("does not count a scoped book the disk lacks as searched", async () => {
            const out = await search(HANAFI);
            expect(out.searched.scoped).toBe(true);
            expect(out.searched.books).toBe(0);
        });

        it("counts only the scoped books that are downloaded", async () => {
            expect((await search(THREE_SCHOOLS)).searched.books).toBe(3);
        });

        it("still reports the scope's own size beside it", async () => {
            // «Scope: 4 books» is what the reader asked for; «searched 3» is
            // what could be read. Both are true, and they are different.
            expect((await search(THREE_SCHOOLS)).scope_count).toBe(4);
        });
    });

    describe("shamela_verify_quote", () => {
        it("does not count a scoped book the disk lacks as searched", async () => {
            const searched = await verify(HANAFI);
            expect(searched.scoped).toBe(true);
            expect(searched.books).toBe(0);
        });

        it("counts only the scoped books that are downloaded", async () => {
            expect((await verify(THREE_SCHOOLS)).books).toBe(3);
        });
    });
});
