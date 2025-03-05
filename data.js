export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query) {
      return new Response(JSON.stringify({ error: "Query tidak boleh kosong" }, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
     try {

      const wikiRes = await fetch(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      if (!wikiRes.ok) throw new Error("Wikipedia data not found"); //Error Lebih Spesifik
      const wikiData = await wikiRes.json();

        // Dapatkan Wikidata ID
        const pageId = wikiData.pageid;
        const wikidataRes = await fetch(`https://id.wikipedia.org/w/api.php?action=query&prop=pageprops&pageids=${pageId}&format=json`);
        const wikidataJson = await wikidataRes.json();
        const wikidataId = wikidataJson.query.pages[pageId]?.pageprops?.wikibase_item;

        if (!wikidataId) throw new Error("Wikidata ID not found");


      // --- Bagian Infobox (dengan SPARQL) ---
       async function getWikidataInfobox(wikidataId) {
         const sparqlQuery = `
          SELECT ?item ?itemLabel ?birthDate ?birthPlaceLabel ?population ?image ?logo ?website
          WHERE {
            ?item wdt:P31 wd:Q5;  #GANTI DENGAN INSTANCE OF YANG SESUAI
                  rdfs:label ?itemLabel.
            FILTER(LANG(?itemLabel) = "id" || LANG(?itemLabel) = "en")

            OPTIONAL { ?item wdt:P569 ?birthDate. }
            OPTIONAL { ?item wdt:P19 ?birthPlace. }
            OPTIONAL { ?item wdt:P1082 ?population. }
            OPTIONAL { ?item wdt:P18 ?image. }
            OPTIONAL { ?item wdt:P154 ?logo. }
            OPTIONAL {?item wdt:P856 ?website. }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],id,en". }
          }
          LIMIT 1
        `;

          const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
           const response = await fetch(url, {headers: {'Accept': 'application/json'}});

            if (!response.ok) {
                throw new Error(`Wikidata API error: ${response.status}`);
            }
          const data = await response.json();
          const bindings = data.results.bindings[0];

          // Format hasil sesuai kebutuhan Anda
          const infobox = {};

           if (bindings?.birthDate) {
               infobox.birthDate = {label: "Birth Date", value: bindings.birthDate.value.substring(0,10)}
           }
            if (bindings?.birthPlaceLabel){
                infobox.birthPlace = {label: "Birth Place", value: bindings.birthPlaceLabel.value}
            }
          //... Tambahkan properti lainnya sesuai kebutuhan

          return infobox;
      }

       const infobox = await getWikidataInfobox(wikidataId);

      // --- Bagian Related Images (dengan Wikimedia Commons API) ---
       async function getRelatedImagesCommons(title) {
          let imageUrls = [];
          let gimcontinue = null;

          do {
              let url = `https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=300&format=json`;
              if (gimcontinue) {
                  url += `&gimcontinue=${gimcontinue}`;
              }

            const res = await fetch(url);
            const data = await res.json();

              if (data.query && data.query.pages) {
                  Object.values(data.query.pages).forEach(page => {
                    if (page.imageinfo) {
                      page.imageinfo.forEach(info => {
                        if (info.width >= 200 && info.url && !info.url.toLowerCase().includes(".svg") ) {
                            imageUrls.push(info.url);
                        }
                      });
                    }
                  });
              }
              gimcontinue = data.continue?.gimcontinue;
          } while(gimcontinue)
          return imageUrls
        }

      const relatedImages = await getRelatedImagesCommons(wikiData.title);
         // --- Gabungkan Hasil ---
      let logo = entity["P154"]?.[0]?.mainsnak?.datavalue?.value; //Logo tetap dari kode awal
      if (logo) {
        logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logo)}?width=200`;
      }

      const result = {
         title: wikiData.title,
        type: entityDesc, //Anda perlu definisikan entityDesc dari wikidata, misal ambil dari description
        description: wikiData.extract,
        image: wikiData.originalimage?.source || null, //Ambil dari wikipedia Summary
        related_images: relatedImages, //Gambar terkait dari commons
        infobox, //Infobox dari wikidata
        source: "Wikipedia", //Bisa disesuaikan
        url: wikiData.content_urls.desktop.page,
        logo //Logo
      };

        return new Response(JSON.stringify({ query, results: [result] }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });

     }
     catch (error){
        //Error handling yang lebih spesifik
         let status = 500;
         let errorMessage = "Internal Server Error";

         if (error.message === "Wikipedia data not found"){
             status = 404;
             errorMessage = "Wikipedia page not found"
         }
         else if (error.message === "Wikidata ID not found"){
              status = 404;
             errorMessage = "Wikidata ID not found for this page"
         }
         //Tambahkan handling error lain jika perlu

         return new Response(JSON.stringify({ error: errorMessage }, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: status,
      });
     }

  },
};
