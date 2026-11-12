'use strict';
// Deterministic offline regression: stale health flags must not make the entire
// movie/episode disappear or erase its saved alternative player URLs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const movieId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const seriesId = '33333333-3333-4333-8333-333333333333';
const seasonId = '44444444-4444-4444-8444-444444444444';
const pendingId = '55555555-5555-4555-8555-555555555555';

function sandboxClient() {
  const tables = {
    aseel_categories: [],
    aseel_movies: [
      { id: movieId, title_ar: 'Test movie', status: 'published',
        rights_status: 'approved', link_health_status: 'suspect',
        stream_url: 'https://media.example.test/old.mp4',
        stream_variants: [{label:'Alternative',url:'https://media.example.test/new.m3u8'}]}
    ],
    aseel_series: [{id:seriesId,title_ar:'Test series',status:'published'}],
    aseel_seasons: [{id:seasonId,series_id:seriesId,number:1}],
    aseel_episodes: [
      {id:episodeId,season_id:seasonId,number:1,title_ar:'Episode 1',
       status:'published',rights_status:'approved',link_health_status:'broken',
       stream_url:'https://media.example.test/stale.mp4',
       stream_variants:[{label:'HLS fallback',url:'https://media.example.test/new.m3u8'}]},
      {id:pendingId,season_id:seasonId,number:2,title_ar:'Episode 2',
       status:'published',rights_status:'pending',link_health_status:'unchecked',
       stream_url:'https://media.example.test/pending.mp4',stream_variants:[]}
    ],
    aseel_channels: [],
    aseel_youtube_videos: [],
    aseel_home_collections: [],
    aseel_home_collection_items: []
  };
  const window = {ALEZZ_CONFIG:{
    supabaseUrl:'https://database.example.test',
    publishableKey:'sb_publishable_test',
    requestTimeout:15000
  }};
  async function fakeFetch(raw) {
    const request = new URL(raw);
    const table = path.posix.basename(request.pathname);
    const matchingId = request.searchParams.get('id');
    let result = tables[table] || [];
    if (matchingId && matchingId.startsWith('eq.'))
      result = result.filter(row => row.id === matchingId.slice(3));
    return {ok:true,json:async()=>result};
  }
  const js = fs.readFileSync(path.join(__dirname,'..','js','api.js'),'utf8');
  vm.runInNewContext(js,{window,fetch:fakeFetch,setTimeout,clearTimeout,console});
  return window.AlezzApi;
}

test('published suspect films and broken episodes keep alternative player sources',async()=>{
  const api=sandboxClient();
  const catalog=await api.load();
  assert.equal(catalog.movies.length,1);
  assert.equal(catalog.movies[0].health,'suspect');
  assert.equal(catalog.movies[0].variants.length,1);
  assert.equal(catalog.series.length,1);
  const episodes=catalog.series[0].seasons[0].episodes;
  assert.equal(episodes.length,2);
  assert.equal(episodes[0].health,'broken');
  assert.equal(episodes[0].variants[0].url,'https://media.example.test/new.m3u8');
});

test('fresh playback reads saved alternatives, but rejects unapproved rights',async()=>{
  const api=sandboxClient();
  const broken=await api.freshPlayback('episode',episodeId);
  assert.ok(broken);
  assert.equal(broken.health,'broken');
  assert.equal(broken.variants.length,1);
  const pending=await api.freshPlayback('episode',pendingId);
  assert.equal(pending,null);
});

test('published films are not hidden by a stale health label',async()=>{
  const api=sandboxClient();
  const catalog=await api.load();
  assert.ok(catalog.items.some(item=>item.key==='movie:'+movieId));
});
