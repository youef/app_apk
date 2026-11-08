import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('authorized',Path(__file__).resolve().parents[1]/'scripts'/'import_authorized_series.py')
a=importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

SAMPLE={'series':[{'title_ar':'مسلسل اختبار','release_year':2025,'country_code':'SA','seasons':[{'number':1,'episodes':[{'number':1,'stream_url':'https://cdn.example.org/video.m3u8'}]}]}]}

class FakeREST:
    def __init__(self):self.rows={'aseel_series':[],'aseel_seasons':[],'aseel_episodes':[]}
    def call(self,table,*,filters=None,method='GET',data=None,prefer=None):
        if method=='GET':
            return [r for r in self.rows[table] if all(
                (r.get(k)==int(v[3:]) if k in ('number','release_year') else r.get(k)==v[3:])
                for k,v in filters.items() if isinstance(v,str) and v.startswith('eq.'))]
        if method=='POST':
            if isinstance(data,list):
                for item in data:self.rows[table].append(dict(item,id='e'+str(len(self.rows[table])+1)))
                return []
            item=dict(data,id=table[6:]+str(len(self.rows[table])+1))
            self.rows[table].append(item)
            return [item]
        raise AssertionError('unexpected method '+method)
    def match(self,table,filters):
        rows=self.call(table,filters=filters)
        if len(rows)>1:raise ValueError('duplicate')
        return rows[0] if rows else None
    def insert(self,table,obj):return self.call(table,method='POST',data=obj)[0]

class TestImporter(unittest.TestCase):
    def test_accept(self):
        data=a.validate(SAMPLE)
        self.assertEqual(data[0]['seasons'][0]['episodes'][0]['stream_url'],'https://cdn.example.org/video.m3u8')
    def test_duplicate_series(self):
        with self.assertRaises(ValueError):a.validate({'series':[SAMPLE['series'][0],SAMPLE['series'][0]]})
    def test_duplicate_episodes(self):
        with self.assertRaises(ValueError):a.validate({'series':[{'title_ar':'عنوان','seasons':[{'number':1,'episodes':[{'number':1},{'number':1}]}]}]})
    def test_reject_http(self):
        with self.assertRaises(ValueError):a.validate({'series':[{'title_ar':'عنوان','poster_url':'http://example.com/x.jpg'}]})
    def test_missing_stream_is_draft(self):
        data=a.validate({'series':[{'title_ar':'عنوان','seasons':[{'number':1,'episodes':[{'number':1}]}]}]})
        self.assertIsNone(data[0]['seasons'][0]['episodes'][0]['stream_url'])
    def test_idempotent_and_draft(self):
        api=FakeREST();manifest=a.validate(SAMPLE)
        first=a.apply(manifest,api);second=a.apply(manifest,api)
        self.assertEqual((first['series_created'],first['seasons_created'],first['episodes_created']),(1,1,1))
        self.assertEqual((second['series_created'],second['seasons_created'],second['episodes_created']),(0,0,0))
        self.assertEqual(api.rows['aseel_series'][0]['status'],'draft')
        self.assertEqual(api.rows['aseel_episodes'][0]['rights_status'],'pending')

if __name__=='__main__':unittest.main()
