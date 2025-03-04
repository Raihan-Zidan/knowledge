export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = request.url.split("?q=")[1];

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
      const entityLabels = entityData.entities[wikidataId]?.labels?.en?.value || wikiData.title;
      const entityDesc = entityData.entities[wikidataId]?.descriptions?.en?.value || wikiData.description || "No description";

      // Fungsi ambil nilai Wikidata
      const getValue = async (prop, label) => {
        const data = entity[prop]?.[0]?.mainsnak?.datavalue?.value;
        if (!data) return null;

        if (typeof data === "object" && data.id) {
          const labelRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${data.id}.json`);
          const labelJson = await labelRes.json();
          return { label, value: labelJson.entities[data.id]?.labels?.en?.value || "Unknown" };
        }

        return { label, value: data };
      };

      // Tambahkan properti yang lebih banyak
      const infobox = (await Promise.all([
        getValue("P571", "Didirikan"), // Tanggal didirikan
        getValue("P112", "Pendiri"), // Founder
        getValue("P749", "Induk"), // Parent company
        getValue("P159", "Kantor pusat"), // Headquarters
        getValue("P39", "Jabatan"), // Posisi (misal "Presiden Indonesia")
        getValue("P569", "Tanggal lahir"), // Tanggal lahir
        getValue("P570", "Tanggal wafat"), // Tanggal wafat
        getValue("P17", "Negara asal"), // Negara asal
        getValue("P166", "Penghargaan"), // Penghargaan
        getValue("P101", "Bidang"), // Bidang kerja
        getValue("P106", "Profesi"), // Profesi
        getValue("P495", "Negara produksi"), // Negara produksi (misal untuk film/game)
        getValue("P577", "Tanggal rilis"), // Tanggal rilis (misal untuk film/game)
      ])).filter(Boolean);

      // Tambahin data default kalau infobox terlalu sedikit
      if (infobox.length < 3) {
        infobox.push({ label: "Wikidata ID", value: wikidataId });
      }

      // Hasil API
      const result = {
        title: wikiData.title,
        type: `${entityLabels} - ${entityDesc}`,
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
