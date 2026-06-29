"""LLM-judge evaluation for the ticket writer.

Measures draft quality with Claude-as-judge (scalar rubric + head-to-head
pairwise) and gates the RL writer promotion on NO-REGRESSION: a new reward model
ships only if its reranked drafts don't lose to the incumbent's on a fixed eval
set. Langfuse (later) just visualizes the same numbers this produces.
"""
