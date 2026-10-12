---
title: Topics
date: "2017-02-11"
updated: "2018-07-17"
permalink: /topics/
author: Dustin
layout: layouts/page.njk
wordpressId: 982
pageSlug: topics
excerpt: Browse posts by featured topics, categories, and tags across Dustin's View.
---

<div class="topics-grid">
  <div class="topic-card">
    <h2>Politics</h2>
    <figure class="wp-caption alignnone"><a href="/tag/politics/"><img loading="lazy" decoding="async" width="300" height="150" src="/media/2017/01/e83db10e2df2053ecd0b4204e2445b97e77fe7d51eb0164191_1920-300x150.png" class="image wp-image-985 attachment-medium size-medium" alt="world map" /></a><figcaption class="wp-caption-text">Politics</figcaption></figure>
  </div>
  <div class="topic-card">
    <h2>Environment</h2>
    <figure class="wp-caption alignnone"><a href="/tag/environment/"><img loading="lazy" decoding="async" width="300" height="200" src="/media/2016/01/IMG_0188-300x200.jpg" class="image wp-image-307 attachment-medium size-medium" alt="backpack with divest symbol attached" /></a><figcaption class="wp-caption-text">Environment</figcaption></figure>
  </div>
  <div class="topic-card">
    <h2>Science / Technology</h2>
    <figure class="wp-caption alignnone"><a href="/tag/sciencetechnology/"><img loading="lazy" decoding="async" width="300" height="300" src="/media/2017/01/java-300x300.jpg" class="image wp-image-929 attachment-medium size-medium" alt="An image of a java version of &quot;if it's yellow let it mellow, if it's brown flush it down.&quot;" /></a><figcaption class="wp-caption-text">Science / Technology</figcaption></figure>
  </div>
  <div class="topic-card">
    <h2>Jokes / Satire</h2>
    <figure class="wp-caption alignnone"><a href="/tag/satire/"><img loading="lazy" decoding="async" width="300" height="231" src="/media/2013/04/Emperor_Clothes_01-300x231.jpg" class="image wp-image-529 attachment-medium size-medium" alt="Illustration of the fable The Emperor's New Clothes" /></a><figcaption class="wp-caption-text">Jokes / Satire</figcaption></figure>
  </div>
  <div class="topic-card">
    <h2>Travel</h2>
    <figure class="wp-caption alignnone"><a href="/tag/travel/"><img loading="lazy" decoding="async" width="300" height="169" src="/media/2016/06/buildings_amsterdam-300x169.jpg" class="image wp-image-613 attachment-medium size-medium" alt="Amsterdam buildings" /></a><figcaption class="wp-caption-text">Travel</figcaption></figure>
  </div>
  <div class="topic-card">
    <h2>Blurbs</h2>
    <figure class="wp-caption alignnone"><a href="/category/blurbs/"><img loading="lazy" decoding="async" width="225" height="225" src="/media/2016/07/wp-1468430424148.jpg" class="image wp-image-549 attachment-full size-full" alt="" /></a><figcaption class="wp-caption-text">Blurbs</figcaption></figure>
  </div>
</div>

<hr>

<section class="topics-categories-section">
  <h2>All Categories</h2>
  <div class="taxonomies-cloud">{% for cat in collections.categoryList %}<a href="/category/{{ cat.slug }}/" class="badge badge-category">{{ cat.name }} ({{ cat.posts.length }})</a>{% endfor %}</div>
</section>

<section class="topics-tags-section">
  <h2>Top Tags</h2>
  <div class="taxonomies-cloud">{% for tag in collections.tagList %}<a href="/tag/{{ tag.slug }}/" class="badge">#{{ tag.name }} ({{ tag.posts.length }})</a>{% endfor %}</div>
</section>
