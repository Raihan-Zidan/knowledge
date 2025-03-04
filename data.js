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
      const wikidataId = wikidataJson.query.pages[pageId]?.pageprops?.wikibase_item;

      if (!wikidataId) throw new Error("Wikidata ID not found");

      // Fetch Wikidata entity data
      const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
      const entityData = await entityRes.json();
      const entity = entityData.entities[wikidataId]?.claims;

      if (!entity) throw new Error("Wikidata entity data not found");

      // Fungsi untuk ambil label dari Wikidata
      const getValue = async (prop, label) => {
        const data = entity[prop]?.[0]?.mainsnak?.datavalue?.value;
        if (!data) return null;

        if (typeof data === "object" && data.id) {
          const labelRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${data.id}.json`);
          const labelJson = await labelRes.json();
          return { label, value: labelJson.entities[data.id]?.labels?.en?.value || "Tidak tersedia" };
        }

        return { label, value: data };
      };

      // Ambil data infobox sesuai jenis entitas
      const infobox = (await Promise.all([
        getValue("P571", "Didirikan"), // Tanggal didirikan (hanya untuk perusahaan)
        getValue("P112", "Pendiri"), // Founder
        getValue("P749", "Induk"), // Parent company
        getValue("P159", "Kantor pusat"), // Headquarters (hanya untuk perusahaan)
        getValue("P39", "Jabatan"), // Posisi (misal "Presiden Indonesia")
        getValue("P569", "Tanggal lahir"), // Tanggal lahir (untuk orang)
        getValue("P570", "Tanggal wafat") // Tanggal wafat (jika ada)
      ])).filter(Boolean); // Hapus yang null

      // Hasil API
      const result = {
        title: wikiData.title,
        description: wikiData.extract,
        logo: wikiData.originalimage?.source || "Tidak tersedia",
        infobox,
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
