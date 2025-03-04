export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query) {
      return new Response(JSON.stringify({ error: "Query tidak boleh kosong" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }

    try {
      // Fetch Wikipedia summary
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      if (!wikiRes.ok) throw new Error("Wikipedia data not found");
      const wikiData = await wikiRes.json();

      // Ambil Wikidata ID dari Wikipedia API
      const pageId = wikiData.pageid;
      const wikidataRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&pageids=${pageId}&format=json`);
      const wikidataJson = await wikidataRes.json();
      const wikidataId = wikidataJson.query.pages[pageId].pageprops.wikibase_item;

      // Fetch Wikidata entity data
      const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
      const entityData = await entityRes.json();
      const entity = entityData.entities[wikidataId].claims;

      // Ambil data penting dari Wikidata
      const getValue = (prop) => entity[prop]?.[0]?.mainsnak?.datavalue?.value || "Tidak tersedia";
      
      const result = {
        title: wikiData.title,
        description: wikiData.extract,
        logo: wikiData.originalimage?.source || "Tidak tersedia",
        infobox: {
          didirikan: getValue("P112"), // Founders
          induk: getValue("P749"), // Parent company
          kantor_pusat: getValue("P159"), // Headquarters
          situs_web: getValue("P856"), // Official website
        },
        source: "Wikipedia & Wikidata",
        url: wikiData.content_urls.desktop.page,
      };

      return new Response(JSON.stringify({ query, results: [result] }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Data tidak ditemukan" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    }
  },
};
