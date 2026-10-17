from types import SimpleNamespace

import pytest

from app.v8_high_transport import ProfileClient, begin_run, load_high_engine


def response():
    return SimpleNamespace(model='deepseek-flash', id='r', usage=None,
        choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content='{"ok":true}', reasoning_content='private reasoning'))])


def test_every_request_explicit_high_without_touching_messages(monkeypatch):
    import openai
    sent=[]
    class Fake:
        def __init__(self, **kwargs): self.chat=SimpleNamespace(completions=self)
        def create(self, **kwargs): sent.append(kwargs); return response()
        def __enter__(self): return self
        def __exit__(self,*args): pass
    monkeypatch.setattr(openai,'OpenAI',Fake)
    records=begin_run()
    messages=[{'role':'user','content':'fixed original input'}]
    with ProfileClient(api_key='fake') as client:
        for _ in range(2):
            assert client.create(model='deepseek-flash',messages=messages,temperature=0).choices[0].message.content=='{"ok":true}'
    assert len(records)==len(sent)==2
    assert all(x['reasoning_effort']=='high' and x['extra_body']=={'thinking':{'type':'enabled'}} for x in sent)
    assert all(x['max_tokens']==32768 and x['messages']==messages for x in sent)
    assert all(x['reasoning_content_chars']>0 and 'reasoning_content' not in x for x in records)
    assert all('private reasoning' not in str(x) for x in records)


def test_frozen_pipeline_and_prompts_are_reused_exactly():
    from app.services import analysis_v8
    engine=load_high_engine()
    assert engine.SOLUTION_SYSTEM_PROMPT==analysis_v8.SOLUTION_SYSTEM_PROMPT
    assert engine.GRADING_SYSTEM_PROMPT==analysis_v8.GRADING_SYSTEM_PROMPT
    assert engine.PIPELINE_VERSION==analysis_v8.PIPELINE_VERSION


def test_wrong_model_rejected_before_network(monkeypatch):
    import openai
    class Fake:
        def __init__(self, **kwargs): self.chat=SimpleNamespace(completions=self)
        def create(self,**kwargs): raise AssertionError('network must not run')
    monkeypatch.setattr(openai,'OpenAI',Fake)
    begin_run()
    with pytest.raises(ValueError,match='deepseek-flash'):
        ProfileClient(api_key='fake').create(model='deepseek-chat',messages=[])
