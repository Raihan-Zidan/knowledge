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

      // Ambil Wikidata ID
      const pageId = wikiData.pageid;
      const wikidataRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&pageids=${pageId}&format=json`);
      const wikidataJson = await wikidataRes.json();
      const wikidataId = wikidataJson.query.pages[pageId]?.pageprops?.wikibase_item;

      if (!wikidataId) throw new Error("Wikidata ID not found");

      // Fetch Wikidata entity data
      const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
      const entityData = await entityRes.json();
      const entity = entityData.entities[wikidataId]?.claims;
      const entityDesc = entityData.entities[wikidataId]?.descriptions?.en?.value || "No description";

      // Cek apakah entitas ini manusia (P31: Q5)
      const isHuman = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q5");

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

      // Ambil properti utama
      let infobox = (await Promise.all([
        getValue("P571", "Didirikan"),
        getValue("P112", "Pendiri"),
        getValue("P749", "Induk"),
        getValue("P159", "Kantor pusat"),
        getValue("P39", "Jabatan"),
        getValue("P569", "Tanggal lahir"),
        getValue("P570", "Tanggal wafat"),
        isHuman ? null : getValue("P17", "Negara asal"), // Hapus negara asal untuk manusia
        getValue("P166", "Penghargaan"),
        getValue("P101", "Bidang"),
        getValue("P106", "Profesi"),
        getValue("P495", "Negara produksi"),
        getValue("P577", "Tanggal rilis")
      ])).filter(Boolean);

      // Properti tambahan kalau infobox kurang dari 5
      if (infobox.length < 5) {
        const extraProps = await Promise.all([
          getValue("P18", "Gambar"),
          getValue("P856", "Situs web"),
          getValue("P625", "Koordinat"),
          isHuman ? getValue("P102", "Partai politik") : null, // Tambah partai politik untuk manusia
          isHuman ? getValue("P69", "Pendidikan") : null, // Tambah pendidikan untuk manusia
          getValue("P212", "ISBN"),
          getValue("P31", "Jenis entitas")
        ]);
        infobox.push(...extraProps.filter(Boolean));

        if (infobox.length < 5) {
          infobox.push({ label: "Wikidata ID", value: wikidataId });
        }
      }

      // Hasil API
      const result = {
        title: wikiData.title,
        type: entityDesc,
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
