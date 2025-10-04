using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WebProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public WebProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Создаем новую вкладку
                var newTabResponse = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/new?{url}", null);
                
                if (!newTabResponse.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to create new tab: {newTabResponse.StatusCode}");
                }

                var newTabResult = await newTabResponse.Content.ReadAsStringAsync();
                var tabData = JsonSerializer.Deserialize<JsonElement>(newTabResult);
                
                if (!tabData.TryGetProperty("id", out var tabIdElement))
                {
                    return StatusCode(500, "Failed to get tab ID");
                }

                var tabId = tabIdElement.GetString();
                
                // Ждем загрузки страницы
                await Task.Delay(5000);

                // Получаем HTML содержимое через правильный endpoint
                var htmlResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json/runtime/evaluate?expression=document.documentElement.outerHTML");
                
                if (!htmlResponse.IsSuccessStatusCode)
                {
                    // Если не работает через runtime/evaluate, попробуем другой способ
                    var pageResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json/page/{tabId}");
                    
                    if (!pageResponse.IsSuccessStatusCode)
                    {
                        return StatusCode(500, $"Failed to get page content: {htmlResponse.StatusCode}");
                    }
                    
                    var pageResult = await pageResponse.Content.ReadAsStringAsync();
                    
                    return Ok(new
                    {
                        success = true,
                        url = url,
                        html = pageResult,
                        timestamp = System.DateTime.UtcNow,
                        method = "page_info"
                    });
                }

                var htmlResult = await htmlResponse.Content.ReadAsStringAsync();
                
                return Ok(new
                {
                    success = true,
                    url = url,
                    html = htmlResult,
                    timestamp = System.DateTime.UtcNow,
                    method = "runtime_evaluate"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }

        [HttpGet("test")]
        public async Task<IActionResult> TestChrome()
        {
            try
            {
                // Проверяем доступность Chrome DevTools
                var response = await _httpClient.GetAsync($"{_chromeDebugUrl}/json");
                
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Chrome DevTools not available: {response.StatusCode}");
                }

                var content = await response.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<JsonElement[]>(content);
                
                return Ok(new
                {
                    success = true,
                    chromeAvailable = true,
                    tabsCount = tabs.Length,
                    tabs = tabs
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
